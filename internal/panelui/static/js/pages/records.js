import { createEmptyUsage, escapeHTML, formatNumber, formatPercent, getSuccessRate } from "../utils.js";
import { renderIcon } from "../components/icons.js";
import { renderPageHeading } from "../components/loading.js";
import { renderCustomSelect } from "../components/custom-select.js";
import { renderUsageRecords } from "../components/usage-records.js";
import { renderCollectionPageSizeSelector, renderCollectionPagination } from "../components/pagination.js";
const RECORDS_PERIODS = [["24h", "24 小时"], ["7d", "7 天"], ["30d", "30 天"], ["all", "全部"]];
const RECORDS_STATUSES = [["all", "全部"], ["success", "成功"], ["failed", "失败"]];
export function renderRecordsPage(state) {
  const isAdmin = state.user?.role === "admin";
  const scope = state.records.scope === "global" && isAdmin ? "global" : "mine";
  const period = state.filters.usagePeriod;

  const scopePills = isAdmin ? `
    <div class="filter-pills" aria-label="记录范围">
      <button class="filter-pill ${scope === "mine" ? "is-active" : ""}" type="button" data-action="set-records-scope" data-scope="mine">我的记录</button>
      <button class="filter-pill ${scope === "global" ? "is-active" : ""}" type="button" data-action="set-records-scope" data-scope="global">全站记录</button>
    </div>
  ` : "";
  if (state.pageLoading && !state.data.records) {
    return `${renderPageHeading("调用记录", "检索每一次 MCP 工具调用的结果、耗时与调试详情。", scopePills)}${renderRecordsLoading()}`;
  }

  const usage = state.data.records || createEmptyUsage();
  const filteredRecords = filterVisibleRecords(usage.records, state.records);
  const successRate = getSuccessRate(usage);
  const toolOptions = Object.keys(usage.by_tool || {}).sort();
  const filtersActive = Boolean(state.records.tool) || state.records.status !== "all";

  return `
    ${renderPageHeading("调用记录", "检索每一次 MCP 工具调用的结果、耗时与调试详情。", scopePills)}
    <div class="summary-strip" aria-label="范围摘要">
      <span class="summary-chip">${renderIcon("activity")} 共 <strong>${escapeHTML(formatNumber(usage.total_calls))}</strong> 次调用</span>
      <span class="summary-chip">${renderIcon("shield")} 成功率 <strong>${escapeHTML(formatPercent(successRate))}</strong></span>
      <span class="summary-chip">${renderIcon("refresh")} 平均耗时 <strong>${usage.total_calls > 0 ? `${escapeHTML(formatNumber(usage.avg_duration_ms))} ms` : "--"}</strong></span>
      <span class="summary-chip">${renderIcon("chart")} 当前 RPM <strong>${escapeHTML(formatNumber(usage.current_rpm))}</strong></span>
    </div>

    <div class="toolbar records-toolbar">
      <div class="filter-pills" aria-label="时间范围">
        ${RECORDS_PERIODS.map(([value, label]) => `
          <button class="filter-pill ${period === value ? "is-active" : ""}" type="button" data-action="set-records-period" data-period="${value}">${label}</button>
        `).join("")}
      </div>
      <div class="records-toolbar-right">
        ${renderCustomSelect({
          id: "records-tool-filter",
          value: state.records.tool,
          ariaLabel: "按工具筛选",
          compact: true,
          dataAttributes: { action: "set-record-tool" },
          options: [{ value: "", label: "全部工具" }, ...toolOptions.map((toolName) => ({ value: toolName, label: toolName }))]
        })}
        <div class="filter-pills" aria-label="调用结果">
          ${RECORDS_STATUSES.map(([value, label]) => `
            <button class="filter-pill ${state.records.status === value ? "is-active" : ""}" type="button" data-action="set-record-status" data-status="${value}">${label}</button>
          `).join("")}
        </div>
      </div>
    </div>

    <article class="data-card">
      <header class="card-header">
        <div>
          <h2>${scope === "global" ? "全站调用明细" : "调用明细"}</h2>
          <p>${filtersActive ? `已按条件筛选，本页 ${filteredRecords.length} / ${usage.records.length} 条` : "按时间倒序排列"}</p>
        </div>
        ${renderCollectionPageSizeSelector("usageRecords", state.pagination.usageRecords)}
      </header>
      ${renderUsageRecords(filteredRecords)}
      ${renderCollectionPagination("usageRecords", state.pagination.usageRecords, filteredRecords.length)}
    </article>
  `;
}

// 工具与结果筛选作用于当前已加载的记录页；时间范围与翻页始终由服务端处理。
function filterVisibleRecords(records, recordsFilters) {
  const toolFilter = String(recordsFilters.tool || "");
  const statusFilter = recordsFilters.status || "all";
  if (!Array.isArray(records)) {
    return [];
  }
  return records.filter((record) => {
    if (toolFilter && record.tool_name !== toolFilter) {
      return false;
    }
    if (statusFilter === "success") {
      return Boolean(record.success);
    }
    if (statusFilter === "failed") {
      return !record.success;
    }
    return true;
  });
}

function renderRecordsLoading() {
  return `
    <div class="summary-strip">
      ${Array.from({ length: 4 }, () => '<div class="skeleton" style="height:34px;width:170px;border-radius:999px"></div>').join("")}
    </div>
    <div class="skeleton" style="height:420px;border-radius:16px"></div>
  `;
}
