import { showToast } from "../components/toast.js";
import { adminPages, availablePages, buildPageHash, pageTabs, readRouteFromLocation } from "../router.js";
import {
  movePaginationCursor,
  resetPagination,
  restorePaginationCursor,
  setPaginationPageSize
} from "../state.js";

// 分页集合归属的页面：access 枢纽页承载三个集合。
const pageByCollection = {
  keys: "keys",
  users: "access",
  tiers: "access",
  invites: "access",
  usageRecords: "records"
};

// 刷新页面时需要重置的分页集合（一页可能有多个）。
const collectionsByPage = {
  keys: ["keys"],
  records: ["usageRecords"],
  access: ["users", "tiers", "invites"]
};

const tabStateKeyByPage = { access: "accessTab", system: "systemTab" };

export function createNavigationEvents({
  state,
  modalController,
  renderApplication,
  loadCurrentPage,
  loadDashboardScopedUsage: loadDashboardScopedUsageHandler,
  normalizeCurrentPageForRole
}) {
  function navigateToPage(page, tab = "") {
    if (!availablePages.has(page)) {
      return;
    }
    if (adminPages.has(page) && state.user?.role !== "admin") {
      showToast("权限不足", "当前账户无法访问系统管理页面。", "error");
      return;
    }
    if (page === "system" && tab === "operations" && !state.data.settings?.operations_metrics_enabled) {
      showToast("运行指标未启用", "请先在服务设置中启用运行指标。", "error");
      return;
    }

    const validTab = pageTabs[page]?.has(tab) ? tab : "";
    state.sidebarOpen = false;
    // 仅切换枢纽页 Tab：不重取数据，直接更新状态并重渲染。
    if (state.currentPage === page && validTab) {
      const tabStateKey = tabStateKeyByPage[page];
      if (tabStateKey && state[tabStateKey] !== validTab) {
        state[tabStateKey] = validTab;
        window.history.replaceState(null, "", `#${buildPageHash(page, validTab)}`);
        renderApplication();
        return;
      }
    }
    modalController.abortCurrentModalRequest();
    state.modal = null;
    if (state.currentPage === page && !validTab) {
      renderApplication();
      return;
    }
    window.location.hash = buildPageHash(page, validTab);
  }

  function handleLocationChange() {
    if (!state.authenticated) {
      return;
    }
    const requestedRoute = readRouteFromLocation();
    if (requestedRoute.redirected) {
      window.history.replaceState(null, "", `#${buildPageHash(requestedRoute.page, requestedRoute.tab)}`);
    }
    const tabStateKey = tabStateKeyByPage[requestedRoute.page];
    const tabChanged = Boolean(tabStateKey && requestedRoute.tab && state[tabStateKey] !== requestedRoute.tab);
    if (requestedRoute.page === state.currentPage && !tabChanged) {
      return;
    }
    if (requestedRoute.page === state.currentPage && tabChanged) {
      // 同一枢纽页内切 Tab：仅重渲染，不重新加载数据。
      state[tabStateKey] = requestedRoute.tab;
      renderApplication();
      return;
    }
    state.currentPage = requestedRoute.page;
    if (tabStateKey && requestedRoute.tab) {
      state[tabStateKey] = requestedRoute.tab;
    }
    normalizeCurrentPageForRole();
    state.sidebarOpen = false;
    modalController.abortCurrentModalRequest();
    state.modal = null;
    loadCurrentPage();
  }

  async function refreshCurrentPage() {
    resetCurrentPagePagination();
    await loadCurrentPage({ refreshing: true });
  }

  async function changeListPage(collectionName, direction) {
    if (pageByCollection[collectionName] !== state.currentPage) {
      return;
    }

    const cursorSnapshot = movePaginationCursor(collectionName, direction);
    if (!cursorSnapshot) {
      return;
    }
    const loaded = await loadCurrentPage({ refreshing: true });
    if (!loaded && state.authenticated) {
      restorePaginationCursor(collectionName, cursorSnapshot);
      renderApplication();
    }
  }

  async function changeUsagePageSize(requestedPageSize) {
    if (state.currentPage !== "records") {
      return;
    }

    const collectionName = "usageRecords";
    const previousPageSize = state.pagination.usageRecords.pageSize;
    if (!setPaginationPageSize(collectionName, requestedPageSize)) {
      return;
    }

    const loaded = await loadCurrentPage({ refreshing: true });
    if (!loaded && state.authenticated) {
      setPaginationPageSize(collectionName, previousPageSize);
      renderApplication();
    }
  }

  async function setRecordsPeriod(period) {
    if (state.currentPage !== "records") {
      return;
    }
    state.filters.usagePeriod = period || "24h";
    state.data.records = null;
    resetPagination("usageRecords");
    await loadCurrentPage();
  }

  async function setRecordsScope(scope) {
    if (state.currentPage !== "records") {
      return;
    }
    const normalizedScope = scope === "global" && state.user?.role === "admin" ? "global" : "mine";
    if (state.records.scope === normalizedScope) {
      return;
    }
    state.records.scope = normalizedScope;
    state.records.tool = "";
    state.records.status = "all";
    state.data.records = null;
    resetPagination("usageRecords");
    await loadCurrentPage();
  }

  function resetCurrentPagePagination() {
    for (const collectionName of collectionsByPage[state.currentPage] || []) {
      resetPagination(collectionName);
    }
  }

  // 仪表盘视角与时间范围切换：24h 直接由聚合载荷提供，其他范围走 scoped 加载。
  async function setDashboardScope(scope) {
    if (state.currentPage !== "dashboard") {
      return;
    }
    const normalizedScope = scope === "global" && state.data.dashboard?.global ? "global" : "mine";
    if (state.dashboard.scope === normalizedScope) {
      return;
    }
    state.dashboard.scope = normalizedScope;
    if (state.dashboard.period === "24h") {
      renderApplication();
      return;
    }
    await loadDashboardScopedUsage();
  }

  async function setDashboardPeriod(period) {
    if (state.currentPage !== "dashboard") {
      return;
    }
    const normalizedPeriod = ["24h", "7d", "30d", "all"].includes(period) ? period : "24h";
    if (state.dashboard.period === normalizedPeriod) {
      return;
    }
    state.dashboard.period = normalizedPeriod;
    if (normalizedPeriod === "24h") {
      renderApplication();
      return;
    }
    await loadDashboardScopedUsage();
  }

  // loadDashboardScopedUsage 由 app.js 注入，负责非 24h 范围的增量加载。
  async function loadDashboardScopedUsage() {
    if (typeof loadDashboardScopedUsageHandler === "function") {
      await loadDashboardScopedUsageHandler();
    }
  }

  function setRecordTool(toolName) {
    state.records.tool = String(toolName || "");
    renderApplication();
  }

  function setRecordStatus(status) {
    state.records.status = ["all", "success", "failed"].includes(status) ? status : "all";
    renderApplication();
  }

  return {
    navigateToPage,
    handleLocationChange,
    refreshCurrentPage,
    changeListPage,
    changeUsagePageSize,
    setRecordsPeriod,
    setRecordsScope,
    setDashboardScope,
    setDashboardPeriod,
    setRecordTool,
    setRecordStatus
  };
}
