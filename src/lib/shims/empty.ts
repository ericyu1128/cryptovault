// Stand-in for Node built-ins that chain SDKs reference but never actually call
// in a browser (fs / net / tls / ws). Aliased in next.config.ts.
export default {};
