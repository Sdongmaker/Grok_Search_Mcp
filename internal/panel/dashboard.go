package panel

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/MapleMapleCat/Grok_Search_Mcp/internal/auth"
	"github.com/MapleMapleCat/Grok_Search_Mcp/internal/store"
)

// dashboardWindow 是仪表盘聚合载荷固定覆盖的最近时间窗口；
// 更长时间范围的用量分析由 /panel/v1/usage 按 ?since= 提供。
const dashboardWindow = 24 * time.Hour

// dashboardRecentRecordLimit 限制聚合载荷中附带的最近调用记录数，保持首屏轻量。
const dashboardRecentRecordLimit = 5

// dashboard 在一个请求内返回仪表盘首屏所需的全部个人数据；管理员额外获得
// 全站维度统计。健康检查有独立缓存与降级语义，仍由 /overview/health 提供。
func (handler *Handler) dashboard(writer http.ResponseWriter, request *http.Request) {
	user, ok := auth.UserFromContext(request.Context())
	if !ok {
		writeError(writer, http.StatusUnauthorized, "unauthorized")
		return
	}
	ctx := request.Context()

	freshUser, err := handler.Store.GetUserByID(ctx, user.ID)
	if err != nil {
		log.Printf("dashboard user %s failed error_type=%T", user.ID, err)
		writeError(writer, http.StatusInternalServerError, "failed to load user")
		return
	}

	// 复用密钥分页的计数查询（仅取 1 行以满足计数语义，不传输完整列表）。
	keysPage, err := handler.Store.ListKeysByUserPage(ctx, user.ID, nil, 1)
	if err != nil {
		log.Printf("dashboard keys summary for user %s failed error_type=%T", user.ID, err)
		writeError(writer, http.StatusInternalServerError, "failed to load keys summary")
		return
	}

	since := time.Now().UTC().Add(-dashboardWindow)
	usageStats, err := handler.Store.GetUserUsageStatsPage(ctx, user.ID, since, nil, dashboardRecentRecordLimit)
	if err != nil {
		log.Printf("dashboard usage for user %s failed error_type=%T", user.ID, err)
		writeError(writer, http.StatusInternalServerError, "failed to load usage")
		return
	}

	response := DashboardResponse{
		User: toUserResponseWithTier(freshUser, handler.loadUserTierForResponse(ctx, freshUser)),
		Keys: DashboardKeysSummary{
			TotalCount:  keysPage.TotalCount,
			ActiveCount: keysPage.ActiveCount,
		},
		Usage: toUsageStatsResponse(usageStats),
	}

	if freshUser.Role == store.RoleAdmin {
		globalStats, globalErr := handler.loadDashboardGlobalStats(ctx, since)
		if globalErr != nil {
			log.Printf("dashboard global stats failed error_type=%T", globalErr)
			writeError(writer, http.StatusInternalServerError, "failed to load global stats")
			return
		}
		response.Global = globalStats
	}

	writeJSON(writer, http.StatusOK, response)
}

// loadDashboardGlobalStats 汇总管理员视角的全站用量与账户/密钥总量。
func (handler *Handler) loadDashboardGlobalStats(ctx context.Context, since time.Time) (*DashboardGlobalStats, error) {
	totalUsers, err := handler.Store.CountUsers(ctx)
	if err != nil {
		return nil, err
	}
	totalKeys, activeKeys, err := handler.Store.CountKeys(ctx)
	if err != nil {
		return nil, err
	}
	globalUsage, err := handler.Store.GetGlobalUsageStatsPage(ctx, since, nil, dashboardRecentRecordLimit)
	if err != nil {
		return nil, err
	}
	return &DashboardGlobalStats{
		TotalUsers: totalUsers,
		TotalKeys:  totalKeys,
		ActiveKeys: activeKeys,
		Usage:      toUsageStatsResponse(globalUsage),
	}, nil
}

// adminGlobalUsage 提供全站任意时间窗口的用量统计（管理员专用），
// 供仪表盘切换时间范围与全站视角时按 ?since= 重新拉取。
func (handler *Handler) adminGlobalUsage(writer http.ResponseWriter, request *http.Request) {
	query, err := parseUsagePageQuery(request)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	stats, err := handler.Store.GetGlobalUsageStatsPage(request.Context(), query.Since, query.Cursor, query.Limit)
	if err != nil {
		log.Printf("admin global usage stats failed error_type=%T", err)
		writeError(writer, http.StatusInternalServerError, "failed to load usage")
		return
	}
	writeJSON(writer, http.StatusOK, toUsageStatsResponse(stats))
}

// adminGlobalUsageRecords 提供跨全部用户的调用记录分页（管理员专用）。
func (handler *Handler) adminGlobalUsageRecords(writer http.ResponseWriter, request *http.Request) {
	query, err := parseUsagePageQuery(request)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	page, err := handler.Store.ListUsageRecordsPage(
		request.Context(),
		store.UsageRecordListScope{IncludeAllUsers: true},
		query.Since,
		query.Cursor,
		query.Limit,
	)
	if err != nil {
		log.Printf("admin global usage records failed error_type=%T", err)
		writeError(writer, http.StatusInternalServerError, "failed to load usage records")
		return
	}
	writeJSON(writer, http.StatusOK, toUsageRecordsResponse(page))
}
