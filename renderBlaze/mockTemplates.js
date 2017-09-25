import _ from 'underscore'

var handler = {
  get: function (target, name) {
    if (name === 'registerHelper') {
      return function(functionName, functionPassed) {
        if(!target.globalHelpers) {
          target.globalHelpers = {};
        }
        if(_.isFunction(functionPassed)) {
          target.globalHelpers[functionName] = function () {
            return functionPassed.apply(this, arguments);
          }
        }
      }
    }
    if (name === 'instance') {
      return function () {
        return target[window.CurrentTemplate]
      }
    }
    if (name === 'subscriptionsReady') {
      return function() {
        return true;
      }
    }
      if (!name || !target || !(name in target)) {
        target[name] = {
          helpers: function (helpers) {
            this.helpers = helpers
          },
          getHelpers: function () {
            function wrapperFunction(key) {
              const targetObject = helpers[key] ? helpers : target.globalHelpers;
              if (!_.isFunction(targetObject[key])) {
                wrappedHelpers[key] = targetObject[key];
              }
              else {
                wrappedHelpers[key] = function () {
                  if (!window.PreviousTemplate || window.PreviousTemplate !== name) {
                    window.PreviousTemplate = window.CurrentTemplate
                    window.CurrentTemplate = name
                  }
                  const value = _.isFunction(targetObject[key]) ? targetObject[key].apply(this, arguments) : targetObject[key]
                  window.CurrentTemplate = window.PreviousTemplate
                  return value;
                }
              }
            }
            const wrappedHelpers = {}
            const helpers = this.helpers
            if(target.globalHelpers) {
              Object.keys(target.globalHelpers).forEach(wrapperFunction);
            }
            Object.keys(helpers).forEach(wrapperFunction);

            return wrappedHelpers
          },
          onCreated: function (callback) {
            this._onCreatedCallback = callback
          },
          _runOnCreatedCallback() {
            this._onCreatedCallback && this._onCreatedCallback.apply(this)
          },
          onRendered() {},
          onDestroyed() {},
          events() {},
          //TODO this most probably shouldn't be here but attached to the callbacks like onCreated
          subscribe() {},
          autorun: function(callback) {
            //TODO not sure if we should bind this...
            callback.apply(this)
          },
        }
      }
      return target[name]
    }
}

Template = new Proxy({}, handler)

