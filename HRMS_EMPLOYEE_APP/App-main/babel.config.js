module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // NOTE: react-native-worklets/plugin is deliberately NOT enabled.
    //
    // The plugin injects the Worklets runtime, which requires the native
    // Worklets/Reanimated libraries to be compiled into the app. Enabling it
    // against a build that lacks them fails at startup with
    // "Native part of Worklets doesn't seem to be initialized" before a
    // single screen renders.
    //
    // The UI uses React Native's built-in Animated API instead, which is part
    // of core RN and needs no native module. Re-enable this line only in the
    // same change that ships a build containing react-native-worklets.
    plugins: [],
  };
};
