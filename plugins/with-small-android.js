const { withGradleProperties } = require('expo/config-plugins');

// Keep this in a config plugin so a clean Expo prebuild preserves the settings.
module.exports = (config) => withGradleProperties(config, (config) => {
  const values = {
    'android.enableBundleCompression': 'true',
    EX_DEV_CLIENT_NETWORK_INSPECTOR: 'false',
  };
  config.modResults = config.modResults.filter(
    (item) => item.type !== 'property' || !(item.key in values),
  );
  for (const [key, value] of Object.entries(values)) {
    config.modResults.push({ type: 'property', key, value });
  }
  return config;
});
