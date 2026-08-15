import { escapeHTML, getInitials } from "../utils.js";
import { renderIcon } from "./icons.js";

// 顶栏健康徽标：复用仪表盘健康检查的状态，点击可重新检查。
function renderHealthPill(health) {
  const presentations = {
    healthy: { className: "is-healthy", label: "服务正常" },
    degraded: { className: "is-degraded", label: "能力受限" },
    unhealthy: { className: "is-unhealthy", label: "上游异常" },
    unknown: { className: "is-unknown", label: "状态未知" }
  };
  const status = String(health?.status || "unknown").toLowerCase();
  const presentation = presentations[status] || presentations.unknown;
  return `
    <button
      class="health-pill ${escapeHTML(presentation.className)}"
      type="button"
      data-action="recheck-health"
      title="上游健康状态：${escapeHTML(presentation.label)}，点击重新检查"
      aria-label="上游健康状态：${escapeHTML(presentation.label)}，点击重新检查"
    ><i></i><span>${escapeHTML(presentation.label)}</span></button>
  `;
}

export function renderShell(state, currentMetadata, currentPageHTML) {
  const isAdmin = state.user?.role === "admin";
  const refreshDisabled = Boolean(state.refreshing || state.formBusy);
  const refreshButtonLabel = refreshDisabled ? "当前操作完成后可刷新" : "刷新当前页面";
  const refreshButtonHTML = currentMetadata.dataMode === "static" ? "" : `
    <button
      class="icon-button ${state.refreshing ? "is-spinning" : ""}"
      type="button"
      data-action="refresh-page"
      aria-label="${refreshButtonLabel}"
      title="${refreshButtonLabel}"
      ${refreshDisabled ? "disabled" : ""}
    >${renderIcon("refresh")}</button>
  `;

  return `
    <div class="app-shell ${state.sidebarOpen ? "is-sidebar-open" : ""}">
      <button class="sidebar-backdrop" type="button" data-action="close-sidebar" aria-label="关闭导航"></button>
      ${renderSidebar(state, isAdmin)}
      <div class="main-shell">
        <header class="topbar">
          <div class="topbar-left">
            <button
              class="icon-button mobile-menu-button"
              type="button"
              data-action="toggle-sidebar"
              aria-controls="primary-navigation"
              aria-expanded="${state.sidebarOpen ? "true" : "false"}"
              aria-label="${state.sidebarOpen ? "关闭导航菜单" : "打开导航菜单"}"
              title="${state.sidebarOpen ? "关闭导航菜单" : "打开导航菜单"}"
            >${renderIcon("menu")}</button>
            <span class="breadcrumb">${escapeHTML(currentMetadata.section)} / <strong>${escapeHTML(currentMetadata.title)}</strong></span>
          </div>
          <div class="topbar-actions">
            ${renderHealthPill(state.data.health)}
            ${refreshButtonHTML}
          </div>
        </header>
        <main class="page-wrap page-enter">
          ${currentPageHTML}
        </main>
      </div>
    </div>
  `;
}

function renderSidebar(state, isAdmin) {
  const renderNavigationItem = (page, label, icon) => `
    <button class="nav-item ${state.currentPage === page ? "is-active" : ""}" type="button" data-action="navigate" data-page="${page}">
      ${renderIcon(icon)}<span>${escapeHTML(label)}</span>
    </button>
  `;

  return `
    <aside class="sidebar" id="primary-navigation">
      <div class="brand-lockup">
        <span class="brand-symbol" aria-hidden="true"></span>
        <span>Grok Search MCP<small>Control plane</small></span>
      </div>

      <div class="sidebar-scroll">
        <section class="nav-section">
          <p class="nav-section-label">Workspace</p>
          <nav class="nav-list" aria-label="工作台导航">
            ${renderNavigationItem("dashboard", "仪表盘", "home")}
            ${renderNavigationItem("records", "调用记录", "activity")}
          </nav>
        </section>

        <section class="nav-section">
          <p class="nav-section-label">Access</p>
          <nav class="nav-list" aria-label="访问导航">
            ${renderNavigationItem("keys", "API 密钥", "key")}
            ${renderNavigationItem("guide", "接入指南", "code")}
          </nav>
        </section>

        ${isAdmin ? `
          <section class="nav-section">
            <p class="nav-section-label">Administration</p>
            <nav class="nav-list" aria-label="系统管理导航">
              ${renderNavigationItem("access", "用户与访问", "users")}
              ${renderNavigationItem("system", "系统", "settings")}
            </nav>
          </section>
        ` : ""}
      </div>

      <footer class="sidebar-footer">
        <div class="sidebar-user">
          <button
            class="sidebar-user-profile ${state.currentPage === "account" ? "is-active" : ""}"
            type="button"
            data-action="navigate"
            data-page="account"
            aria-label="查看账户信息"
          >
            <span class="user-avatar">${escapeHTML(getInitials(state.user?.username))}</span>
            <span class="sidebar-user-copy">
              <strong>${escapeHTML(state.user?.username || "User")}</strong>
              <span>${state.user?.role === "admin" ? "管理员" : escapeHTML(state.user?.tier_name || "普通用户")}</span>
            </span>
          </button>
          <button class="logout-button" type="button" data-action="logout" aria-label="退出登录">${renderIcon("logout")}</button>
        </div>
      </footer>
    </aside>
  `;
}
