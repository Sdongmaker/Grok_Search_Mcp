import {
  calculatePercent,
  createEmptyUsage,
  escapeHTML,
  formatDateTime,
  formatLimit,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  getSuccessRate
} from "../utils.js";
import { renderIcon } from "../components/icons.js";
import { renderPageHeading } from "../components/loading.js";
import { renderMetricCard } from "../components/metric-card.js";
import { renderToolBreakdown } from "../components/tool-breakdown.js";
import { renderChart } from "../components/usage-chart.js";
const DASHBOARD_PERIODS = [["24h", "24 小时"], ["7d", "7 天"], ["30d", "30 天"], ["all", "全部"]];

// resolveDashboardUsage 按当前视角与时间范围选择应展示的用量统计；
// 非 24h 范围需要 dashboardScopedUsage 已就位，否则返回 null 由页面显示加载态。
// 注意：定义在页面模块内而非 state.js，避免 pages → state → router → pages 的循环导入
//（js_test 的递归模块打包器不支持循环）。
function resolveDashboardUsage(currentState) {
  const dashboard = currentState.data.dashboard;
  if (!dashboard) {
    return null;
  }
  const scope = currentState.dashboard.scope === "global" && dashboard.global ? "global" : "mine";
  const period = currentState.dashboard.period;
  if (period === "24h") {
    return scope === "global" ? dashboard.global.usage : dashboard.usage;
  }
  const scopedUsage = currentState.data.dashboardScopedUsage;
  if (scopedUsage && scopedUsage.scope === scope && scopedUsage.period === period) {
    return scopedUsage.usage;
  }
  return null;
}
export function renderDashboardPage(state) {
  if (state.pageLoading && !state.data.dashboard) {
    return renderDashboardLoading();
  }

  const dashboard = state.data.dashboard;
  const user = state.user || dashboard?.user || {};
  const isGlobalScope = state.dashboard.scope === "global" && Boolean(dashboard?.global);
  const period = state.dashboard.period;
  const usage = resolveDashboardUsage(state);
  const scopedPending = usage === null;
  const viewUsage = usage || createEmptyUsage();
  const successRate = getSuccessRate(viewUsage);
  const successLimit = Number(user.success_limit || 0);
  const successCalls = Number(user.success_calls || 0);
  const quotaPercent = successLimit > 0 ? calculatePercent(successCalls, successLimit) : 100;
  const healthPresentation = getHealthPresentation(state.data.health);

  return `
    ${renderPageHeading("仪表盘", "服务用量、健康状态与账户额度的一屏聚合视图。", renderHeadingControls(state, dashboard))}
    ${renderHero(user, dashboard, isGlobalScope, quotaPercent, successLimit, healthPresentation)}
    ${scopedPending ? renderScopedUsageLoading() : `
      <section class="metric-grid" aria-label="核心指标">
        ${renderMetricCard("总调用", formatNumber(viewUsage.total_calls), getPeriodLabel(period), "activity", "#efecff", "#6f64f0", false, "trend", viewUsage.traffic_buckets)}
        ${renderMetricCard("成功率", formatPercent(successRate), `${formatNumber(viewUsage.success_calls)} 次成功`, "shield", "#e7f7ed", "#1f8a52", successRate >= 95, "ring", successRate)}
        ${renderMetricCard("平均耗时", viewUsage.total_calls > 0 ? `${formatNumber(viewUsage.avg_duration_ms)} ms` : "--", "单次调用的平均耗时", "refresh", "#e9f1fe", "#3a7ef4", false, "bar", viewUsage.avg_duration_ms)}
        ${renderMetricCard("当前 RPM", formatNumber(viewUsage.current_rpm), isGlobalScope ? "全站最近一分钟" : "最近一分钟", "chart", "#fdf5e2", "#c98a1b", false, "pulse", viewUsage.current_rpm)}
      </section>

      <section class="dashboard-grid">
        <article class="content-card">
          <header class="card-header">
            <div><h2>调用趋势</h2><p>${escapeHTML(getPeriodLabel(period))}${isGlobalScope ? " · 全站" : ""}</p></div>
            <button class="button button-ghost button-sm" type="button" data-action="navigate" data-page="records">调用记录 ${renderIcon("arrowRight")}</button>
          </header>
          <div class="card-body chart-wrap">${renderChart(viewUsage.traffic_buckets)}</div>
        </article>
        <article class="content-card">
          <header class="card-header"><div><h2>热门工具</h2><p>按调用次数排序</p></div></header>
          <div class="card-body">${renderToolBreakdown(viewUsage.by_tool)}</div>
        </article>
      </section>

      ${renderRecentRecords(viewUsage.records, isGlobalScope)}
    `}
  `;
}

// 头部控制区：管理员可在「我的用量 / 全站概览」之间切换，所有角色都可切换时间范围。
function renderHeadingControls(state, dashboard) {
  const scopePills = dashboard?.global ? `
    <div class="filter-pills" aria-label="统计范围">
      <button class="filter-pill ${state.dashboard.scope !== "global" ? "is-active" : ""}" type="button" data-action="set-dashboard-scope" data-scope="mine">我的用量</button>
      <button class="filter-pill ${state.dashboard.scope === "global" ? "is-active" : ""}" type="button" data-action="set-dashboard-scope" data-scope="global">全站概览</button>
    </div>
  ` : "";
  const periodPills = `
    <div class="filter-pills" aria-label="时间范围">
      ${DASHBOARD_PERIODS.map(([value, label]) => `
        <button class="filter-pill ${state.dashboard.period === value ? "is-active" : ""}" type="button" data-action="set-dashboard-period" data-period="${value}">${label}</button>
      `).join("")}
    </div>
  `;
  return `${scopePills}${periodPills}`;
}

function renderHero(user, dashboard, isGlobalScope, quotaPercent, successLimit, healthPresentation) {
  const greeting = getGreeting();
  const keySummary = dashboard?.keys || { total_count: 0, active_count: 0 };
  const heroChips = isGlobalScope
    ? `
      <span class="hero-chip">全站用户 <strong>${escapeHTML(formatNumber(dashboard.global.total_users))}</strong></span>
      <span class="hero-chip">全站密钥 <strong>${escapeHTML(formatNumber(dashboard.global.total_keys))}</strong></span>
      <span class="hero-chip">启用中 <strong>${escapeHTML(formatNumber(dashboard.global.active_keys))}</strong></span>
    `
    : `
      <span class="hero-chip">方案 <strong>${escapeHTML(user.tier_name || "未分配")}</strong></span>
      <span class="hero-chip">RPM <strong>${escapeHTML(formatLimit(user.rpm))}</strong></span>
      <span class="hero-chip">密钥 <strong>${escapeHTML(formatNumber(keySummary.active_count))} / ${escapeHTML(formatNumber(keySummary.total_count))}</strong></span>
    `;

  return `
    <section class="hero-card">
      <div class="hero-content">
        <div>
          <p class="hero-kicker">Realtime MCP workspace</p>
          <h2>${escapeHTML(greeting)}，${escapeHTML(user.username || "用户")}。<br><span class="hero-status-copy ${escapeHTML(healthPresentation.className)}">${escapeHTML(healthPresentation.headline)}</span></h2>
          <div class="hero-health" role="status" aria-label="服务健康状态：${escapeHTML(healthPresentation.label)}">
            <span class="hero-health-chip ${escapeHTML(healthPresentation.className)}">${escapeHTML(healthPresentation.label)}</span>
            <span>${escapeHTML(healthPresentation.detail)}</span>
            ${healthPresentation.checkedAt ? `<span>最近检查 ${escapeHTML(formatDateTime(healthPresentation.checkedAt))}</span>` : ""}
          </div>
        </div>
        <div class="hero-meta">${heroChips}</div>
      </div>
      <div class="hero-gauge-wrap">
        <div class="hero-gauge" style="--gauge-value:${quotaPercent.toFixed(1)}%">
          <div class="hero-gauge-copy">
            <strong>${successLimit > 0 ? escapeHTML(formatPercent(quotaPercent, 0)) : "∞"}</strong>
            <span>${successLimit > 0 ? "我的本月额度已用" : "成功调用不限"}</span>
          </div>
        </div>
      </div>
    </section>
  `;
}

// 最近调用预览：紧凑行，详情与翻页在调用记录页完成。
function renderRecentRecords(records, isGlobalScope) {
  const recentRecords = Array.isArray(records) ? records.slice(0, 5) : [];
  const rows = recentRecords.length === 0
    ? `<p class="recent-records-empty">所选范围内还没有调用，接入客户端后即可在这里看到最新动态。</p>`
    : recentRecords.map((record) => `
      <div class="recent-record-row">
        <span class="cell-icon is-green">${renderIcon("activity")}</span>
        <span class="recent-record-tool">${escapeHTML(record.tool_name || "unknown")}</span>
        <span class="status-badge ${record.success ? "is-enabled" : "is-failed"}">${record.success ? "成功" : "失败"}</span>
        <span class="recent-record-duration">${escapeHTML(formatNumber(record.duration_ms))} ms</span>
        <time class="recent-record-time">${escapeHTML(formatRelativeTime(record.timestamp))}</time>
      </div>
    `).join("");

  return `
    <article class="content-card recent-records-card">
      <header class="card-header">
        <div><h2>最近调用</h2><p>${isGlobalScope ? "全站最新 5 条请求" : "最新 5 条请求"}</p></div>
        <button class="button button-ghost button-sm" type="button" data-action="navigate" data-page="records">查看全部 ${renderIcon("arrowRight")}</button>
      </header>
      <div class="recent-records">${rows}</div>
    </article>
  `;
}

function renderScopedUsageLoading() {
  return `
    <section class="metric-grid">
      ${Array.from({ length: 4 }, () => '<div class="skeleton" style="height:142px;border-radius:16px"></div>').join("")}
    </section>
    <section class="dashboard-grid">
      <div class="skeleton" style="height:350px;border-radius:16px"></div>
      <div class="skeleton" style="height:350px;border-radius:16px"></div>
    </section>
  `;
}

function renderDashboardLoading() {
  return `
    ${renderPageHeading("仪表盘", "正在同步服务状态与调用指标。")}
    <div class="skeleton" style="height:252px;border-radius:24px;margin-bottom:18px"></div>
    ${renderScopedUsageLoading()}
  `;
}

function getPeriodLabel(period) {
  const labels = { "24h": "最近 24 小时", "7d": "最近 7 天", "30d": "最近 30 天", all: "全部时间" };
  return labels[period] || labels["24h"];
}

function getHealthPresentation(health) {
  const presentations = {
    healthy: {
      className: "is-healthy",
      label: "正常",
      headline: "健康检查正常。",
      detail: "上游模型接口可达，当前模型已列出"
    },
    degraded: {
      className: "is-degraded",
      label: "受限",
      headline: "服务能力受限。",
      detail: "上游模型接口可达，但当前配置模型未列出"
    },
    unhealthy: {
      className: "is-unhealthy",
      label: "异常",
      headline: "上游健康检查异常。",
      detail: "无法通过模型接口验证上游可用性"
    },
    unknown: {
      className: "is-unknown",
      label: "未知",
      headline: "服务状态未知。",
      detail: "尚未取得有效的健康检查结果"
    }
  };
  const status = String(health?.status || "unknown").toLowerCase();
  return {
    ...(presentations[status] || presentations.unknown),
    checkedAt: health?.checked_at || ""
  };
}

function getGreeting() {
  const currentHour = new Date().getHours();
  if (currentHour < 6) return "夜深了";
  if (currentHour < 12) return "早上好";
  if (currentHour < 18) return "下午好";
  return "晚上好";
}
