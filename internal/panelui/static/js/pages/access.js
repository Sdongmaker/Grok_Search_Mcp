import { escapeHTML } from "../utils.js";
import { renderIcon } from "../components/icons.js";
import { renderPageHeading } from "../components/loading.js";
import { renderUsersPage } from "./users.js";
import { renderTiersPage } from "./tiers.js";
import { renderInvitesPage } from "./invite-codes.js";
const ACCESS_TABS = [
  { tab: "users", label: "用户", icon: "users", description: "管理账户角色、启用状态、配额方案与现有会话。" },
  { tab: "tiers", label: "配额方案", icon: "layers", description: "集中维护请求速率与月度成功调用额度，方案变更即时作用于已分配用户。" },
  { tab: "invites", label: "邀请码", icon: "ticket", description: "创建并管理注册邀请码，跟踪每个邀请码的注册用量。" }
];
// 「用户与访问」枢纽页：三个子页面共享同一工作流（邀请 → 注册 → 配额 → 观察），
// 通过 Tab 聚合，子页面以 embedded 模式复用既有渲染。
export function renderAccessPage(state) {
  const activeTab = ACCESS_TABS.some((tabConfig) => tabConfig.tab === state.accessTab)
    ? state.accessTab
    : "users";
  const activeTabConfig = ACCESS_TABS.find((tabConfig) => tabConfig.tab === activeTab);
  return `
    ${renderPageHeading("用户与访问", activeTabConfig.description, renderAccessTabs(activeTab))}
    ${renderActiveAccessPanel(state, activeTab)}
  `;
}

function renderAccessTabs(activeTab) {
  return `
    <div class="hub-tabs" role="tablist" aria-label="访问管理分类">
      ${ACCESS_TABS.map((tabConfig) => `
        <button
          class="hub-tab ${activeTab === tabConfig.tab ? "is-active" : ""}"
          type="button"
          role="tab"
          aria-selected="${activeTab === tabConfig.tab}"
          data-action="navigate"
          data-page="access"
          data-tab="${tabConfig.tab}"
        >${renderIcon(tabConfig.icon)}<span>${escapeHTML(tabConfig.label)}</span></button>
      `).join("")}
    </div>
  `;
}

function renderActiveAccessPanel(state, activeTab) {
  const panelByTab = {
    users: () => renderUsersPage(state, { embedded: true }),
    tiers: () => renderTiersPage(state, { embedded: true }),
    invites: () => renderInvitesPage(state, { embedded: true })
  };
  return `<div class="hub-panel" role="tabpanel">${(panelByTab[activeTab] || panelByTab.users)()}</div>`;
}
