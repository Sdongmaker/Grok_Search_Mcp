import { renderShell as renderLayoutShell } from "./components/layout.js";
import { renderAccountPage } from "./pages/account.js";
import { renderAccessPage } from "./pages/access.js";
import { renderConfigurationGuidePage } from "./pages/configuration-guide.js";
import { renderDashboardPage } from "./pages/dashboard.js";
import { renderKeysPage } from "./pages/keys.js";
import { renderRecordsPage } from "./pages/records.js";
import { renderSystemPage } from "./pages/system.js";

export const pageMetadata = {
  dashboard: { title: "仪表盘", section: "工作台", render: renderDashboardPage },
  records: { title: "调用记录", section: "工作台", render: renderRecordsPage },
  keys: { title: "API 密钥", section: "访问", render: renderKeysPage },
  guide: { title: "接入指南", section: "访问", dataMode: "static", render: renderConfigurationGuidePage },
  access: { title: "用户与访问", section: "系统管理", render: renderAccessPage },
  system: { title: "系统", section: "系统管理", render: renderSystemPage },
  account: { title: "账户信息", section: "账户", render: renderAccountPage }
};

export const availablePages = new Set(Object.keys(pageMetadata));
export const adminPages = new Set(["access", "system"]);

// 枢纽页合法的子 Tab：hash 形如 #access/tiers。
export const pageTabs = {
  access: new Set(["users", "tiers", "invites"]),
  system: new Set(["settings", "operations"])
};

// 旧版页面地址全部重定向到新信息架构，保证书签与历史链接可用。
const legacyPageRedirects = {
  overview: "dashboard",
  usage: "records",
  tutorial: "guide",
  users: "access/users",
  tiers: "access/tiers",
  invites: "access/invites",
  settings: "system/settings",
  operationsMetrics: "system/operations"
};

export function isStaticPage(page) {
  return pageMetadata[page]?.dataMode === "static";
}

// readRouteFromLocation 解析 hash 为 {page, tab}；旧地址会被改写为新路由。
export function readRouteFromLocation(locationHash = window.location.hash) {
  const rawRoute = locationHash.replace(/^#\/?/, "").trim();
  const [rawPage, rawTab = ""] = rawRoute.split("/");

  const redirectTarget = legacyPageRedirects[rawPage];
  if (redirectTarget) {
    const [redirectPage, redirectTab = ""] = redirectTarget.split("/");
    return { page: redirectPage, tab: redirectTab, redirected: true };
  }

  if (!availablePages.has(rawPage)) {
    return { page: "dashboard", tab: "", redirected: Boolean(rawPage) };
  }

  const validTabs = pageTabs[rawPage];
  const tab = validTabs?.has(rawTab) ? rawTab : "";
  return { page: rawPage, tab, redirected: false };
}

export function readPageFromLocation(locationHash = window.location.hash) {
  return readRouteFromLocation(locationHash).page;
}

// buildPageHash 生成页面（含可选 Tab）的 hash 地址。
export function buildPageHash(page, tab = "") {
  const validTab = pageTabs[page]?.has(tab) ? tab : "";
  return validTab ? `${page}/${validTab}` : page;
}

export function renderCurrentPage(state) {
  return (pageMetadata[state.currentPage]?.render || pageMetadata.dashboard.render)(state);
}

export function renderShell(state) {
  const currentMetadata = pageMetadata[state.currentPage] || pageMetadata.dashboard;
  return renderLayoutShell(state, currentMetadata, renderCurrentPage(state));
}
