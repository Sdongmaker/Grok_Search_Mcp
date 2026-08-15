import { escapeHTML } from "../utils.js";
import { renderIcon } from "../components/icons.js";
import { renderPageHeading } from "../components/loading.js";
import { renderSettingsPage } from "./settings.js";
import { renderOperationsMetricsPage } from "./operations-metrics.js";
// 「系统」枢纽页：服务设置与运行指标同属运维工作流，通过 Tab 聚合。
// 运行指标 Tab 仅在服务端启用 operations_metrics_enabled 后可用。
export function renderSystemPage(state) {
  const operationsEnabled = Boolean(state.data.settings?.operations_metrics_enabled);
  const systemTabs = [
    { tab: "settings", label: "服务设置", icon: "settings", description: "热更新上游连接、搜索并发、默认模型、代理、注册策略与运维观测。" },
    { tab: "operations", label: "运行指标", icon: "activity", description: "观察 Go 进程、内存与 GC、SQLite、用量写入、限流和认证保护状态。" }
  ];

  const requestedTab = state.systemTab;
  const activeTab = requestedTab === "operations" && !operationsEnabled ? "settings" : requestedTab;
  const activeTabConfig = systemTabs.find((tabConfig) => tabConfig.tab === activeTab) || systemTabs[0];
  return `
    ${renderPageHeading("系统", activeTabConfig.description, renderSystemTabs(systemTabs, activeTab, operationsEnabled))}
    <div class="hub-panel" role="tabpanel">
      ${activeTab === "operations"
        ? renderOperationsMetricsPage(state, { embedded: true })
        : renderSettingsPage(state, { embedded: true })}
    </div>
  `;
}

function renderSystemTabs(systemTabs, activeTab, operationsEnabled) {
  return `
    <div class="hub-tabs" role="tablist" aria-label="系统管理分类">
      ${systemTabs.map((tabConfig) => {
        const tabDisabled = tabConfig.tab === "operations" && !operationsEnabled;
        return `
          <button
            class="hub-tab ${activeTab === tabConfig.tab ? "is-active" : ""}"
            type="button"
            role="tab"
            aria-selected="${activeTab === tabConfig.tab}"
            data-action="navigate"
            data-page="system"
            data-tab="${tabConfig.tab}"
            ${tabDisabled ? "disabled title=\"先在服务设置中启用运行指标\"" : ""}
          >${renderIcon(tabConfig.icon)}<span>${escapeHTML(tabConfig.label)}</span></button>
        `;
      }).join("")}
    </div>
  `;
}
