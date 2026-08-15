import { readRouteFromLocation } from "./router.js";
import { COLLECTION_PAGE_SIZE, COLLECTION_PAGE_SIZE_OPTIONS } from "./pagination-config.js";
import {
  commitCursorPagination,
  createCursorPaginationState,
  moveCursorPagination,
  restoreCursorPagination
} from "./cursor-pagination.js";

export { COLLECTION_PAGE_SIZE, COLLECTION_PAGE_SIZE_OPTIONS } from "./pagination-config.js";

function createPaginationState(pageSize = COLLECTION_PAGE_SIZE) {
  return createCursorPaginationState(pageSize, {
    totalCount: 0,
    activeCount: 0,
    assignedUserCount: 0
  });
}

const initialRoute = readRouteFromLocation();

export const state = {
  authenticated: false,
  user: null,
  registrationMode: "free",
  authenticationSettingsStatus: "loading",
  authenticationSettingsError: "",
  turnstileEnabled: false,
  turnstileSiteKey: "",
  authMode: "login",
  authBusy: false,
  authError: "",
  currentPage: initialRoute.page,
  accessTab: initialRoute.page === "access" && initialRoute.tab ? initialRoute.tab : "users",
  systemTab: initialRoute.page === "system" && initialRoute.tab ? initialRoute.tab : "settings",
  pageLoading: false,
  refreshing: false,
  formBusy: false,
  settingsApplyWarning: null,
  sidebarOpen: false,
  modal: null,
  dashboard: {
    scope: "mine",
    period: "24h"
  },
  records: {
    scope: "mine",
    tool: "",
    status: "all"
  },
  filters: {
    usagePeriod: "24h",
    userSearch: ""
  },
  pagination: {
    keys: createPaginationState(),
    users: createPaginationState(),
    tiers: createPaginationState(),
    invites: createPaginationState(),
    usageRecords: createPaginationState()
  },
  data: {
    keys: null,
    health: null,
    dashboard: null,
    dashboardScopedUsage: null,
    records: null,
    users: null,
    tiers: null,
    defaultTier: null,
    invites: null,
    settings: null,
    operationsMetrics: null,
    operationsHistory: [],
    models: null
  }
};

export function clearCachedData() {
  for (const dataKey of Object.keys(state.data)) {
    // operationsHistory 是环形缓冲数组，重置为空数组而非 null。
    state.data[dataKey] = dataKey === "operationsHistory" ? [] : null;
  }
  state.settingsApplyWarning = null;
  for (const paginationKey of Object.keys(state.pagination)) {
    resetPagination(paginationKey, { preservePageSize: false });
  }
}

export function applyAuthenticationSettings(stateToUpdate, authenticationSettings) {
  const registrationMode = String(authenticationSettings?.registration_mode || "");
  const validRegistrationModes = new Set(["free", "invite", "disabled"]);
  const turnstileEnabled = Boolean(authenticationSettings?.turnstile_enabled);
  const turnstileSiteKey = String(authenticationSettings?.turnstile_site_key || "").trim();

  if (!validRegistrationModes.has(registrationMode) || (turnstileEnabled && !turnstileSiteKey)) {
    stateToUpdate.authenticationSettingsStatus = "error";
    stateToUpdate.authenticationSettingsError = "后端返回了无效的登录访问策略，请联系管理员。";
    return false;
  }

  stateToUpdate.registrationMode = registrationMode;
  stateToUpdate.turnstileEnabled = turnstileEnabled;
  stateToUpdate.turnstileSiteKey = turnstileEnabled ? turnstileSiteKey : "";
  stateToUpdate.authenticationSettingsStatus = "ready";
  stateToUpdate.authenticationSettingsError = "";
  if (registrationMode === "disabled") {
    stateToUpdate.authMode = "login";
  }
  return true;
}

export function resetPagination(collectionName, options = {}) {
  if (!Object.hasOwn(state.pagination, collectionName)) {
    return;
  }
  const preservePageSize = options.preservePageSize !== false;
  const currentPageSize = preservePageSize
    ? state.pagination[collectionName]?.pageSize
    : COLLECTION_PAGE_SIZE;
  state.pagination[collectionName] = createPaginationState(currentPageSize);
}

export function setPaginationPageSize(collectionName, requestedPageSize) {
  const pagination = state.pagination[collectionName];
  const pageSize = Number(requestedPageSize);
  if (!pagination || !COLLECTION_PAGE_SIZE_OPTIONS.includes(pageSize) || pagination.pageSize === pageSize) {
    return false;
  }
  state.pagination[collectionName] = createPaginationState(pageSize);
  return true;
}

export function movePaginationCursor(collectionName, direction) {
  return moveCursorPagination(state.pagination[collectionName], direction);
}

export function restorePaginationCursor(collectionName, snapshot) {
  restoreCursorPagination(state.pagination[collectionName], snapshot);
}

function commitPagination(collectionName, response) {
  const pagination = state.pagination[collectionName];
  if (!pagination) {
    return;
  }
  commitCursorPagination(pagination, response);
  pagination.totalCount = Number(response?.total_count ?? pagination.totalCount ?? 0);
  pagination.activeCount = Number(response?.active_count ?? pagination.activeCount ?? 0);
  pagination.assignedUserCount = Number(response?.assigned_user_count ?? pagination.assignedUserCount ?? 0);
}

export function clearAuthenticatedState() {
  state.authenticated = false;
  state.user = null;
  state.authBusy = false;
  state.formBusy = false;
  state.pageLoading = false;
  state.refreshing = false;
  state.sidebarOpen = false;
  state.modal = null;
  state.authMode = "login";
  clearCachedData();
}

export function pageHasExistingData(page) {
  switch (page) {
    case "dashboard":
      return Boolean(state.data.dashboard);
    case "records":
      return Boolean(state.data.records);
    case "keys":
      return Boolean(state.data.keys);
    case "access":
      return Boolean(state.data.users && state.data.tiers && state.data.invites);
    case "system":
      return Boolean(state.data.settings);
    case "account":
      return Boolean(state.user);
    default:
      return false;
  }
}

export function commitPageData(page, pageResult) {
  switch (page) {
    case "keys":
      state.data.keys = pageResult.keyResponse?.keys || [];
      commitPagination("keys", pageResult.keyResponse);
      break;
    case "dashboard":
      state.user = pageResult.user;
      state.data.dashboard = pageResult.dashboard;
      state.data.dashboardScopedUsage = null;
      if (pageResult.settings) {
        state.data.settings = pageResult.settings;
        state.settingsApplyWarning = null;
      }
      break;
    case "records":
      state.data.records = pageResult.usage;
      commitPagination("usageRecords", pageResult.usage);
      break;
    case "access":
      state.data.users = pageResult.userResponse?.users || [];
      state.data.tiers = pageResult.tierResponse?.tiers || [];
      state.data.defaultTier = pageResult.tierResponse?.default_tier || null;
      state.data.invites = pageResult.inviteResponse?.invite_codes || [];
      commitPagination("users", pageResult.userResponse);
      commitPagination("tiers", pageResult.tierResponse);
      commitPagination("invites", pageResult.inviteResponse);
      break;
    case "system":
      state.data.settings = pageResult.settings;
      state.settingsApplyWarning = null;
      if (pageResult.operationsMetrics) {
        state.data.operationsMetrics = pageResult.operationsMetrics;
      }
      break;
    case "account":
      state.user = pageResult.user;
      break;
    default:
      break;
  }
}

export function normalizeUsage(usage) {
  return {
    total_calls: Number(usage?.total_calls || 0),
    success_calls: Number(usage?.success_calls || 0),
    avg_duration_ms: Number(usage?.avg_duration_ms || 0),
    current_rpm: Number(usage?.current_rpm || 0),
    by_tool: usage?.by_tool || {},
    traffic_buckets: usage?.traffic_buckets || [],
    records: usage?.records || [],
    next_cursor: String(usage?.next_cursor || ""),
    has_more: Boolean(usage?.has_more)
  };
}

// normalizeDashboard 规整仪表盘聚合载荷；global 仅管理员存在。
export function normalizeDashboard(dashboard) {
  if (!dashboard || typeof dashboard !== "object") {
    return null;
  }
  return {
    user: dashboard.user || null,
    keys: {
      total_count: Number(dashboard.keys?.total_count || 0),
      active_count: Number(dashboard.keys?.active_count || 0)
    },
    usage: normalizeUsage(dashboard.usage),
    global: dashboard.global
      ? {
        total_users: Number(dashboard.global.total_users || 0),
        total_keys: Number(dashboard.global.total_keys || 0),
        active_keys: Number(dashboard.global.active_keys || 0),
        usage: normalizeUsage(dashboard.global.usage)
      }
      : null
  };
}

export function findItemByIdentifier(items, identifier) {
  return Array.isArray(items)
    ? items.find((item) => item.id === identifier)
    : undefined;
}

export function replaceItemByIdentifier(items, updatedItem) {
  if (!Array.isArray(items) || !updatedItem?.id) {
    return Array.isArray(items) ? [...items] : [];
  }

  return items.map((item) => item.id === updatedItem.id ? updatedItem : item);
}

export function removeItemByIdentifier(items, identifier) {
  return Array.isArray(items) ? items.filter((item) => item.id !== identifier) : [];
}

export function compareTiers(firstTier, secondTier) {
  const creationTimeComparison = String(firstTier.created_at || "").localeCompare(String(secondTier.created_at || ""));
  return creationTimeComparison || String(firstTier.id || "").localeCompare(String(secondTier.id || ""));
}
