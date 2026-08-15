package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/MapleMapleCat/Grok_Search_Mcp/internal/auth"
	"github.com/MapleMapleCat/Grok_Search_Mcp/internal/store"
)

// dashboardTestFixture 准备一名普通用户与一名管理员，各自持有一个密钥，
// 并写入带耗时的调用记录，供仪表盘聚合断言使用。
func dashboardTestFixture(t *testing.T, sqliteStore *store.SQLiteStore, jwtSecret string) (regularToken, adminToken string) {
	t.Helper()
	ctx := context.Background()

	regularUser, err := sqliteStore.CreateUser(ctx, "dashboard-user", "hash", store.RoleUser)
	if err != nil {
		t.Fatal(err)
	}
	administrator, err := sqliteStore.CreateUser(ctx, "dashboard-admin", "hash", store.RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	regularKey, _, err := sqliteStore.CreateKey(ctx, regularUser.ID, "user-key", 20)
	if err != nil {
		t.Fatal(err)
	}
	adminKey, _, err := sqliteStore.CreateKey(ctx, administrator.ID, "admin-key", 20)
	if err != nil {
		t.Fatal(err)
	}

	recordTimestamp := time.Now().UTC()
	for _, usageRecord := range []store.UsageRecord{
		{KeyID: regularKey.ID, ToolName: "grok_web_search", Timestamp: recordTimestamp, DurationMs: 200, Success: true},
		{KeyID: regularKey.ID, ToolName: "grok_web_search", Timestamp: recordTimestamp, DurationMs: 400, Success: false},
		{KeyID: adminKey.ID, ToolName: "grok_x_search", Timestamp: recordTimestamp, DurationMs: 600, Success: true},
	} {
		if err := sqliteStore.RecordUsage(ctx, usageRecord); err != nil {
			t.Fatal(err)
		}
	}

	issueToken := func(user *store.User) string {
		t.Helper()
		token, _, issueErr := auth.IssuePanelToken(jwtSecret, user, 0)
		if issueErr != nil {
			t.Fatal(issueErr)
		}
		return token
	}
	return issueToken(regularUser), issueToken(administrator)
}

func requestDashboard(t *testing.T, testServerURL, path, token string) (int, []byte) {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, testServerURL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.DefaultClient.Do(withJWT(request, token))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var responseBody []byte
	buffer := new(bytes.Buffer)
	if _, err := buffer.ReadFrom(response.Body); err != nil {
		t.Fatal(err)
	}
	responseBody = buffer.Bytes()
	return response.StatusCode, responseBody
}

func TestDashboardRequiresAuthentication(t *testing.T) {
	testServer, _, _ := panelTestServer(t)
	defer testServer.Close()

	response, err := http.Get(testServer.URL + "/panel/v1/dashboard")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("dashboard status = %d, want %d", response.StatusCode, http.StatusUnauthorized)
	}
}

func TestDashboardRegularUserReceivesPersonalAggregateOnly(t *testing.T) {
	testServer, sqliteStore, configuration := panelTestServer(t)
	defer testServer.Close()

	regularToken, _ := dashboardTestFixture(t, sqliteStore, configuration.JWTSecret)
	statusCode, responseBody := requestDashboard(t, testServer.URL, "/panel/v1/dashboard", regularToken)
	if statusCode != http.StatusOK {
		t.Fatalf("dashboard status = %d, body = %s", statusCode, responseBody)
	}

	var dashboard DashboardResponse
	if err := json.Unmarshal(responseBody, &dashboard); err != nil {
		t.Fatal(err)
	}
	if dashboard.User.Username != "dashboard-user" {
		t.Fatalf("dashboard user = %q, want dashboard-user", dashboard.User.Username)
	}
	if dashboard.Keys.TotalCount != 1 || dashboard.Keys.ActiveCount != 1 {
		t.Fatalf("keys summary = %+v, want 1 total / 1 active", dashboard.Keys)
	}
	if dashboard.Usage.TotalCalls != 2 || dashboard.Usage.SuccessCalls != 1 {
		t.Fatalf("usage = %+v, want 2 total / 1 success", dashboard.Usage)
	}
	// 两条记录耗时 200ms 与 400ms，平均应为 300ms。
	if dashboard.Usage.AvgDurationMs != 300 {
		t.Fatalf("avg_duration_ms = %d, want 300", dashboard.Usage.AvgDurationMs)
	}
	if len(dashboard.Usage.Records) > dashboardRecentRecordLimit {
		t.Fatalf("records = %d, want <= %d", len(dashboard.Usage.Records), dashboardRecentRecordLimit)
	}
	if dashboard.Global != nil {
		t.Fatalf("regular user dashboard must not include global stats: %+v", dashboard.Global)
	}
}

func TestDashboardAdminReceivesGlobalStats(t *testing.T) {
	testServer, sqliteStore, configuration := panelTestServer(t)
	defer testServer.Close()

	_, adminToken := dashboardTestFixture(t, sqliteStore, configuration.JWTSecret)
	statusCode, responseBody := requestDashboard(t, testServer.URL, "/panel/v1/dashboard", adminToken)
	if statusCode != http.StatusOK {
		t.Fatalf("dashboard status = %d, body = %s", statusCode, responseBody)
	}

	var dashboard DashboardResponse
	if err := json.Unmarshal(responseBody, &dashboard); err != nil {
		t.Fatal(err)
	}
	if dashboard.Global == nil {
		t.Fatal("admin dashboard must include global stats")
	}
	if dashboard.Global.TotalUsers != 2 {
		t.Fatalf("global total_users = %d, want 2", dashboard.Global.TotalUsers)
	}
	if dashboard.Global.TotalKeys != 2 || dashboard.Global.ActiveKeys != 2 {
		t.Fatalf("global keys = %d total / %d active, want 2/2", dashboard.Global.TotalKeys, dashboard.Global.ActiveKeys)
	}
	// 全站 3 条记录（两个用户合计），成功 2 条，耗时均值 (200+400+600)/3 = 400ms。
	if dashboard.Global.Usage.TotalCalls != 3 || dashboard.Global.Usage.SuccessCalls != 2 {
		t.Fatalf("global usage = %+v, want 3 total / 2 success", dashboard.Global.Usage)
	}
	if dashboard.Global.Usage.AvgDurationMs != 400 {
		t.Fatalf("global avg_duration_ms = %d, want 400", dashboard.Global.Usage.AvgDurationMs)
	}
	if dashboard.Global.Usage.ByTool["grok_x_search"] != 1 {
		t.Fatalf("global by_tool = %+v, want grok_x_search=1", dashboard.Global.Usage.ByTool)
	}
	// 管理员个人视角仅包含自己的 1 条记录。
	if dashboard.Usage.TotalCalls != 1 {
		t.Fatalf("admin personal usage = %d, want 1", dashboard.Usage.TotalCalls)
	}
}

func TestAdminGlobalUsageEndpointsEnforceAdminRole(t *testing.T) {
	testServer, sqliteStore, configuration := panelTestServer(t)
	defer testServer.Close()

	regularToken, adminToken := dashboardTestFixture(t, sqliteStore, configuration.JWTSecret)

	for _, path := range []string{"/panel/v1/admin/usage", "/panel/v1/admin/usage/records"} {
		statusCode, _ := requestDashboard(t, testServer.URL, path, regularToken)
		if statusCode != http.StatusForbidden {
			t.Fatalf("%s with user token status = %d, want %d", path, statusCode, http.StatusForbidden)
		}
	}

	statusCode, responseBody := requestDashboard(t, testServer.URL, "/panel/v1/admin/usage", adminToken)
	if statusCode != http.StatusOK {
		t.Fatalf("admin global usage status = %d, body = %s", statusCode, responseBody)
	}
	var usage UsageStatsResponse
	if err := json.Unmarshal(responseBody, &usage); err != nil {
		t.Fatal(err)
	}
	if usage.TotalCalls != 3 {
		t.Fatalf("admin global usage total_calls = %d, want 3", usage.TotalCalls)
	}

	statusCode, responseBody = requestDashboard(t, testServer.URL, "/panel/v1/admin/usage/records", adminToken)
	if statusCode != http.StatusOK {
		t.Fatalf("admin global records status = %d, body = %s", statusCode, responseBody)
	}
	var records UsageRecordsResponse
	if err := json.Unmarshal(responseBody, &records); err != nil {
		t.Fatal(err)
	}
	if len(records.Records) != 3 {
		t.Fatalf("admin global records = %d, want 3", len(records.Records))
	}
}
