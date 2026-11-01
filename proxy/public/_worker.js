// Pages advanced mode: forward the request as-is (same URL, headers, body) to the production Worker.
export default {
  fetch(request, env) {
    return env.APP.fetch(request);
  },
};
