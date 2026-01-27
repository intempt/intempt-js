
  (function (w) {
    if (w.intempt && (w.intempt._isReal || w.intempt._isStub)) return;

    var queue = [];
    var pendingPromises = [];
    var nextPromiseId = 1;

    function enqueue(method, args) {
      queue.push({ method: method, args: args, timestamp: Date.now() });
    }

    function makeVoidMethod(method) {
      return function () {
        enqueue(method, Array.prototype.slice.call(arguments));
      };
    }

    function makeReturnMethod(method, fallbackValue) {
      return function () {
        enqueue(method, Array.prototype.slice.call(arguments));
        return fallbackValue;
      };
    }

    function recommendation() {
      var args = Array.prototype.slice.call(arguments);
      var promiseId = nextPromiseId++;

      enqueue("recommendation", args);

      var promiseInfo = { id: promiseId };
      pendingPromises.push(promiseInfo);

      return new Promise(function (resolve, reject) {
        promiseInfo.resolve = resolve;
        promiseInfo.reject = reject;
      });
    }

    w.intempt = {
      _isStub: true,
      _queue: queue,
      _pendingPromises: pendingPromises,

      getProfileId: makeReturnMethod("getProfileId", undefined),
      optIn: makeVoidMethod("optIn"),
      optOut: makeVoidMethod("optOut"),
      isUserOptIn: makeReturnMethod("isUserOptIn", true),

      identify: makeVoidMethod("identify"),
      group: makeVoidMethod("group"),
      track: makeVoidMethod("track"),
      record: makeVoidMethod("record"),
      alias: makeVoidMethod("alias"),
      consent: makeVoidMethod("consent"),

      productAdd: makeVoidMethod("productAdd"),
      productOrdered: makeVoidMethod("productOrdered"),
      productView: makeVoidMethod("productView"),

      logOut: makeVoidMethod("logOut"),
      recommendation: recommendation
    };
  })(window);

