// Test stand-in for a web-editor bundle that DOES export `mount` (INT-3706):
// records the payload it was mounted with.
export function mount(root, payload) {
  (window.__testEsmMountCalls ||= []).push(payload);
}
