// Only the development server and explicit test builds expose account shortcuts.
// A URL parameter or local-storage setting cannot enable them in a release build.
export const TEST_CONTROLS = import.meta.env.DEV || import.meta.env.MODE === 'test';
