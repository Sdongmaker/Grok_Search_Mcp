import {
  APIError,
  fetchAllTiers,
  fetchAdminGlobalUsage,
  fetchAdminGlobalUsageRecords,
  fetchAdminUsers,
  fetchCurrentUser,
  fetchDashboard,
  fetchInviteCodes,
  fetchKeys,
  fetchOperationalMetrics,
  fetchOverviewHealth,
  fetchRegistrationSettings,
  fetchSettings,
  fetchUsage,
  fetchUsageRecords,
  panelAPI
} from "./js/api.js";
import { renderAuthView } from "./js/components/forms.js";
import { configureCustomSelects } from "./js/components/custom-select.js";
import { renderModal } from "./js/components/modal.js";
import { configureToastRegion, showToast } from "./js/components/toast.js";
import { createApplicationEvents } from "./js/events.js";
import { getErrorMessage } from "./js/events/event-helpers.js";
import { adminPages, availablePages, isStaticPage, pageMetadata, renderShell } from "./js/router.js";
import { renderSafeHTML } from "./js/safe-html.js";
import {
  applyAuthenticationSettings,
  clearAuthenticatedState,
  COLLECTION_PAGE_SIZE,
  commitPageData,
  normalizeDashboard,
  normalizeUsage,
  pageHasExistingData,
  state
} from "./js/state.js";
import { getUsagePeriodSince } from "./js/utils.js";
import { preloadTurnstileScript, synchronizeLoginTurnstile } from "./js/turnstile.js";

const applicationElement = document.querySelector("#app");
const modalRegionElement = document.querySelector("#modal-region");
const toastRegionElement = document.querySelector("#toast-region");

let activePageRequestIdentifier = 0;
let activePageRequestController = null;
let activeOverviewHealthRequestController = null;
let authenticationSettingsRequestIdentifier = 0;
let operationsPollingTimer = null;

// 运行指标轮询间隔与趋势缓冲长度（仅客户端，不影响后端）。
const OPERATIONS_POLL_INTERVAL_MS = 5000;
const OPERATIONS_HISTORY_LIMIT = 30;

function abortCurrentPageLoad() {
  activePageRequestController?.abort();
  activePageRequestController = null;
  activeOverviewHealthRequestController?.abort();
  activeOverviewHealthRequestController = null;
  activePageRequestIdentifier += 1;
}

function renderApplication() {
  renderSafeHTML(applicationElement, state.authenticated ? renderShell(state) : renderAuthView(state));
  synchronizeLoginTurnstile({
    enabled: !state.authenticated && !state.authBusy && state.authMode === "login" && state.turnstileEnabled,
    siteKey: state.turnstileSiteKey
  });
  renderModalRegion();
  document.title = state.authenticated
    ? `${pageMetadata[state.currentPage]?.title || "控制台"} · Grok Search MCP`
    : "登录 · Grok Search MCP Control";
  syncOperationsPolling();
}

function renderModalRegion() {
  renderSafeHTML(modalRegionElement, renderModal(state));
}

// 顶栏健康徽标的点击重检查：中断在途探测后立即重新加载。
function recheckHealth() {
  activeOverviewHealthRequestController?.abort();
  activeOverviewHealthRequestController = null;
  void loadHealthIndependently(activePageRequestIdentifier);
}

// 仅在「系统 → 运行指标」Tab 激活且服务端已启用时轮询；离开即停止。
function syncOperationsPolling() {
  const shouldPoll = Boolean(
    state.authenticated
    && state.currentPage === "system"
    && state.systemTab === "operations"
    && state.data.settings?.operations_metrics_enabled
  );

  if (!shouldPoll) {
    if (operationsPollingTimer) {
      clearInterval(operationsPollingTimer);
      operationsPollingTimer = null;
    }
    return;
  }
  if (operationsPollingTimer) {
    return;
  }
  operationsPollingTimer = setInterval(pollOperationsMetrics, OPERATIONS_POLL_INTERVAL_MS);
}

async function pollOperationsMetrics() {
  try {
    const operationsMetrics = await fetchOperationalMetrics();
    if (state.currentPage !== "system" || state.systemTab !== "operations") {
      return;
    }
    state.data.operationsMetrics = operationsMetrics;
    pushOperationsHistorySample(operationsMetrics);
    renderApplication();
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }
    // 轮询失败保留上一份快照；会话失效走统一登出。
    handleSessionError(error);
  }
}

function pushOperationsHistorySample(operationsMetrics) {
  const history = Array.isArray(state.data.operationsHistory) ? state.data.operationsHistory : [];
  history.push({
    goroutines: Number(operationsMetrics?.runtime?.goroutines || 0),
    heapBytes: Number(operationsMetrics?.runtime?.memory?.heap_allocated_bytes || 0)
  });
  if (history.length > OPERATIONS_HISTORY_LIMIT) {
    history.splice(0, history.length - OPERATIONS_HISTORY_LIMIT);
  }
  state.data.operationsHistory = history;
}

async function initializeApplication() {
  if (!panelAPI.hasSession()) {
    // Start the cross-origin request while the public authentication settings load.
    void preloadTurnstileScript().catch(() => {});
  }

  configureToastRegion(toastRegionElement);
  configureCustomSelects();
  createApplicationEvents({
    applicationElement,
    modalRegionElement,
    renderApplication,
    renderModalRegion,
    loadCurrentPage,
    loadDashboardScopedUsage,
    recheckHealth,
    abortCurrentPageLoad,
    normalizeCurrentPageForRole,
    handleSessionError,
    reloadAuthenticationSettings: loadAuthenticationSettings
  }).register();

  await loadAuthenticationSettings();
  if (!panelAPI.hasSession()) {
    renderApplication();
    return;
  }

  try {
    state.user = await fetchCurrentUser();
    if (state.user?.role === "admin") {
      try {
        state.data.settings = await fetchSettings();
        state.settingsApplyWarning = null;
      } catch (error) {
        if (error instanceof APIError && error.status === 401) {
          throw error;
        }
        state.data.settings = null;
      }
    }
    state.authenticated = true;
    normalizeCurrentPageForRole();
    renderApplication();
    await loadCurrentPage();
  } catch (error) {
    panelAPI.clearSession();
    clearAuthenticatedState();
    if (!(error instanceof APIError && error.status === 401)) {
      state.authError = getErrorMessage(error);
    }
    renderApplication();
  }
}

async function loadAuthenticationSettings() {
  authenticationSettingsRequestIdentifier += 1;
  const requestIdentifier = authenticationSettingsRequestIdentifier;
  state.authenticationSettingsStatus = "loading";
  state.authenticationSettingsError = "";
  try {
    const registrationSettings = await fetchRegistrationSettings();
    if (requestIdentifier !== authenticationSettingsRequestIdentifier) {
      return false;
    }
    return applyAuthenticationSettings(state, registrationSettings);
  } catch (error) {
    if (requestIdentifier !== authenticationSettingsRequestIdentifier) {
      return false;
    }
    state.authenticationSettingsStatus = "error";
    state.authenticationSettingsError = getErrorMessage(error);
    return false;
  }
}

function normalizeCurrentPageForRole() {
  if (!availablePages.has(state.currentPage)) {
    state.currentPage = "dashboard";
  }
  if (adminPages.has(state.currentPage) && state.user?.role !== "admin") {
    state.currentPage = "dashboard";
    window.history.replaceState(null, "", "#dashboard");
  }
  // 运行指标并入系统页 Tab；未启用时回退到服务设置 Tab。
  if (state.currentPage === "system" && state.systemTab === "operations" && !state.data.settings?.operations_metrics_enabled) {
    state.systemTab = "settings";
    window.history.replaceState(null, "", "#system/settings");
  }
}

async function loadCurrentPage(options = {}) {
  abortCurrentPageLoad();

  const page = state.currentPage;
  if (isStaticPage(page)) {
    state.pageLoading = false;
    state.refreshing = false;
    renderApplication();
    // 静态页（接入指南）同样需要顶栏与状态徽标的健康数据。
    void loadHealthIndependently(activePageRequestIdentifier);
    return true;
  }

  const requestIdentifier = activePageRequestIdentifier;
  const requestController = new AbortController();
  activePageRequestController = requestController;
  state.pageLoading = !pageHasExistingData(page);
  state.refreshing = Boolean(options.refreshing);
  renderApplication();

  try {
    const pageResult = await loadPageData(page, requestController.signal);
    if (requestIdentifier !== activePageRequestIdentifier) {
      return false;
    }
    commitPageData(page, pageResult);
    // 健康检查独立异步加载：失败降级为 unknown，不阻塞页面主体。
    void loadHealthIndependently(requestIdentifier);
    return true;
  } catch (error) {
    if (requestIdentifier !== activePageRequestIdentifier) {
      return false;
    }
    if (error?.name === "AbortError") {
      return false;
    }
    if (handleSessionError(error)) {
      return false;
    }
    showToast("加载失败", getErrorMessage(error), "error");
    return false;
  } finally {
    if (activePageRequestController === requestController) {
      activePageRequestController = null;
    }
    if (requestIdentifier === activePageRequestIdentifier && state.authenticated) {
      state.pageLoading = false;
      state.refreshing = false;
      renderApplication();
    }
  }
}

// loadHealthIndependently 为仪表盘/接入指南与顶栏健康徽标提供独立的健康检查加载。
async function loadHealthIndependently(requestIdentifier) {
  const requestController = new AbortController();
  activeOverviewHealthRequestController = requestController;

  try {
    const health = await fetchOverviewHealth({ signal: requestController.signal });
    if (requestIdentifier !== activePageRequestIdentifier) {
      return;
    }
    state.data.health = health;
  } catch (error) {
    if (requestIdentifier !== activePageRequestIdentifier || error?.name === "AbortError") {
      return;
    }
    if (handleSessionError(error)) {
      return;
    }
    state.data.health = { status: "unknown", checked_at: "" };
  } finally {
    if (activeOverviewHealthRequestController === requestController) {
      activeOverviewHealthRequestController = null;
    }
    if (requestIdentifier === activePageRequestIdentifier && state.authenticated) {
      renderApplication();
    }
  }
}

// loadDashboardScopedUsage 为非 24h 范围或全站视角增量加载用量统计，
// 避免重复请求仪表盘聚合载荷。
async function loadDashboardScopedUsage() {
  const scope = state.dashboard.scope === "global" && state.data.dashboard?.global ? "global" : "mine";
  const period = state.dashboard.period;
  const since = getUsagePeriodSince(period);
  state.data.dashboardScopedUsage = null;
  renderApplication();

  try {
    const scopedUsage = scope === "global"
      ? await fetchAdminGlobalUsage({ since, limit: 5 })
      : await fetchUsage(since, { limit: 5 });
    if (state.currentPage !== "dashboard" || state.dashboard.scope !== scope || state.dashboard.period !== period) {
      return;
    }
    state.data.dashboardScopedUsage = {
      scope,
      period,
      usage: normalizeUsage(scopedUsage)
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }
    if (handleSessionError(error)) {
      return;
    }
    showToast("加载失败", getErrorMessage(error), "error");
  } finally {
    if (state.authenticated && state.currentPage === "dashboard") {
      renderApplication();
    }
  }
}

async function loadPageData(page, signal) {
  switch (page) {
    case "dashboard": {
      // 单请求聚合首屏；管理员附带全站统计。设置仅用于运行指标 Tab 的可见性判断。
      const settingsRequest = state.user?.role === "admin" && !state.data.settings
        ? fetchSettings({ signal }).catch(() => null)
        : Promise.resolve(state.data.settings || null);
      const [dashboard, settings] = await Promise.all([
        fetchDashboard({ signal }),
        settingsRequest
      ]);
      return {
        user: dashboard?.user || state.user,
        dashboard: normalizeDashboard(dashboard),
        settings
      };
    }
    case "keys": {
      return { keyResponse: await fetchCollectionPage(fetchKeys, state.pagination.keys, signal) };
    }
    case "records": {
      const since = getUsagePeriodSince(state.filters.usagePeriod);
      const cursor = state.pagination.usageRecords.cursor;
      const pageSize = state.pagination.usageRecords.pageSize;
      const isGlobalScope = state.records.scope === "global" && state.user?.role === "admin";
      if (cursor) {
        const recordPage = isGlobalScope
          ? await fetchAdminGlobalUsageRecords({ signal, since, cursor, limit: pageSize })
          : await fetchUsageRecords(since, { signal, cursor, limit: pageSize });
        return {
          usage: normalizeUsage({
            ...(state.data.records || {}),
            records: recordPage?.records || [],
            next_cursor: recordPage?.next_cursor || "",
            has_more: Boolean(recordPage?.has_more)
          })
        };
      }
      const usage = isGlobalScope
        ? await fetchAdminGlobalUsage({ signal, since, limit: pageSize })
        : await fetchUsage(since, { signal, limit: pageSize });
      return { usage: normalizeUsage(usage) };
    }
    case "access": {
      // 枢纽页一次加载三个 Tab 的数据，切换 Tab 不再产生请求。
      const [userResponse, tierResponse, inviteResponse] = await Promise.all([
        fetchCollectionPage(fetchAdminUsers, state.pagination.users, signal),
        fetchAllTiers({ signal, limit: 100 }),
        fetchCollectionPage(fetchInviteCodes, state.pagination.invites, signal)
      ]);
      return { userResponse, tierResponse, inviteResponse };
    }
    case "system": {
      const settings = await fetchSettings({ signal });
      // 运行指标仅在启用时拉取；激活 Tab 后由轮询保持更新。
      const operationsMetrics = settings?.operations_metrics_enabled
        ? await fetchOperationalMetrics({ signal }).catch(() => null)
        : null;
      return { settings, operationsMetrics };
    }
    case "account":
      return { user: await fetchCurrentUser({ signal }) };
    default:
      return {};
  }
}

function fetchCollectionPage(fetchCollection, pagination, signal) {
  return fetchCollection({
    signal,
    cursor: pagination.cursor,
    limit: COLLECTION_PAGE_SIZE
  });
}

function handleSessionError(error) {
  if (!(error instanceof APIError) || error.status !== 401) {
    return false;
  }

  abortCurrentPageLoad();
  panelAPI.clearSession();
  clearAuthenticatedState();
  state.authError = "会话已失效，请重新登录。";
  state.authenticationSettingsStatus = "loading";
  state.authenticationSettingsError = "";
  renderApplication();
  void loadAuthenticationSettings().then(() => {
    if (!state.authenticated) {
      renderApplication();
    }
  });
  return true;
}

initializeApplication();
