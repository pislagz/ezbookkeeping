package settings

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/mayswind/ezbookkeeping/pkg/core"
)

func loadOfflineTestConfig(t *testing.T, extraIni string) *Config {
	root, err := filepath.Abs(filepath.Join("..", ".."))
	assert.Nil(t, err)

	workDir := t.TempDir()

	for _, dir := range []string{"storage", "data", "log", "public"} {
		assert.Nil(t, os.MkdirAll(filepath.Join(workDir, dir), 0700))
	}

	t.Setenv(ebkWorkDirEnvName, workDir)

	content, err := os.ReadFile(filepath.Join(root, "conf", "ezbookkeeping.ini"))
	assert.Nil(t, err)

	path := filepath.Join(t.TempDir(), "test.ini")
	assert.Nil(t, os.WriteFile(path, append(content, []byte("\n"+extraIni)...), 0600))

	config, err := LoadConfiguration(path)
	assert.Nil(t, err)

	return config
}

func TestOfflineMode_DefaultIsOff(t *testing.T) {
	config := loadOfflineTestConfig(t, "")

	assert.False(t, config.OfflineMode)
	assert.True(t, config.EnableAssetPricesAutoUpdate)
}

func TestOfflineMode_FromIni(t *testing.T) {
	config := loadOfflineTestConfig(t, "[network]\noffline_mode = true\n[map]\nmap_provider = openstreetmap\n[user]\navatar_provider = gravatar\n")

	assert.True(t, config.OfflineMode)
	assert.False(t, config.EnableAssetPricesAutoUpdate)
	assert.Equal(t, "", config.MapProvider)
	assert.False(t, config.EnableMapDataFetchProxy)
	assert.Equal(t, core.UserAvatarProviderType(""), config.AvatarProvider)
}

func TestOfflineMode_FromEnvironment(t *testing.T) {
	t.Setenv("EBK_NETWORK_OFFLINE_MODE", "true")
	config := loadOfflineTestConfig(t, "[network]\noffline_mode = false\n[map]\nmap_provider = openstreetmap\n")

	assert.True(t, config.OfflineMode)
	assert.Equal(t, "", config.MapProvider)
	assert.False(t, config.EnableAssetPricesAutoUpdate)
}

func TestOfflineMode_OffKeepsMapAndGravatar(t *testing.T) {
	config := loadOfflineTestConfig(t, "[map]\nmap_provider = openstreetmap\n[user]\navatar_provider = gravatar\n")

	assert.False(t, config.OfflineMode)
	assert.Equal(t, "openstreetmap", config.MapProvider)
	assert.Equal(t, core.USER_AVATAR_PROVIDER_GRAVATAR, config.AvatarProvider)
}
