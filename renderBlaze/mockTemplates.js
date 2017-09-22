import _ from 'underscore'

var handler = {
  get: function (target, name) {
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
            const wrappedHelpers = {}
            const helpers = this.helpers
            Object.keys(helpers).forEach((key) => {
              wrappedHelpers[key] = function() {
                if (!window.PreviousTemplate || window.PreviousTemplate !== name) {
                  window.PreviousTemplate = window.CurrentTemplate
                  window.CurrentTemplate = name
                }
                const value = _.isFunction(helpers[key]) ? helpers[key]() : helpers[key]
                window.CurrentTemplate = window.PreviousTemplate
                return value;
              }
            })
            return wrappedHelpers
          },
          onCreated: function (callback) {
            callback.apply(this)
          },
          onRendered() {},
          events() {},
        }
      }
      return target[name]
    }
}

Template = new Proxy({}, handler)

