/* global window */
// C159.7 (Workflow 9A, flow-server-embed): the e2e embedding page's script. It mounts the flow with
// `OpenVerify.embed` from the options in the page's fragment and records what the page learns:
// `window.openverifyEvents` (each callback, in order) and `window.openverifyMessages` (every
// message the page receives, with its origin), so a spec can check that no message carries a
// token, a step id or a field value.
(function () {
  'use strict';
  var params = new URLSearchParams(window.location.hash.slice(1));
  var optional = function (name) {
    var value = params.get(name);
    return value === null ? undefined : value;
  };
  window.openverifyEvents = [];
  window.openverifyMessages = [];
  window.addEventListener('message', function (event) {
    window.openverifyMessages.push({ origin: event.origin, data: event.data });
  });
  var record = function (name) {
    return function (payload) {
      window.openverifyEvents.push({ name: name, payload: payload === undefined ? null : payload });
    };
  };
  window.openverifyHandle = window.OpenVerify.embed({
    container: '#verify',
    flowUrl: params.get('flow-url'),
    inquiryId: params.get('inquiry-id'),
    sessionToken: optional('session-token'),
    oneTimeLink: optional('one-time-token'),
    language: optional('language'),
    // Workflow 9D Stage 1 amendment 12: a full-stack embed spec can draw the flow dark.
    styleVariant: optional('style-variant'),
    iframeTitle: 'Identity verification',
    onLoad: record('load'),
    onReady: record('ready'),
    onEvent: record('event'),
    onComplete: record('complete'),
    onCancel: record('cancel'),
    onError: record('error'),
  });
})();
