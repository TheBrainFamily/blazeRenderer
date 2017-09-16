import _ from 'underscore'
BlazeMine = {}

class ReactiveVar {
  set(value) {
    this.value = value;
  }
  get() {
    return this.value;
  }
}

BlazeMine._globalHelpers = {};

BlazeMine.View = {}
// Documented as Template.registerHelper.
// This definition also provides back-compat for `UI.registerHelper`.
BlazeMine.registerHelper = function (name, func) {
  BlazeMine._globalHelpers[name] = func;
};

// Also documented as Template.deregisterHelper
BlazeMine.deregisterHelper = function(name) {
  delete BlazeMine._globalHelpers[name];
};

var bindIfIsFunction = function (x, target) {
  if (typeof x !== 'function')
    return x;
  return BlazeMine._bind(x, target);
};

// If `x` is a function, binds the value of `this` for that function
// to the current data context.
var bindDataContext = function (x) {
  if (typeof x === 'function') {
    return function () {
      var data = BlazeMine.getData();
      if (data == null)
        data = {};
      return x.apply(data, arguments);
    };
  }
  return x;
};

BlazeMine._OLDSTYLE_HELPER = {};

BlazeMine._getTemplateHelper = function (template, name, tmplInstanceFunc) {
  // XXX COMPAT WITH 0.9.3
  var isKnownOldStyleHelper = false;

  if (template.__helpers.has(name)) {
    var helper = template.__helpers.get(name);
    if (helper === BlazeMine._OLDSTYLE_HELPER) {
      isKnownOldStyleHelper = true;
    } else if (helper != null) {
      return wrapHelper(bindDataContext(helper), tmplInstanceFunc);
    } else {
      return null;
    }
  }

  // old-style helper
  if (name in template) {
    // Only warn once per helper
    if (! isKnownOldStyleHelper) {
      template.__helpers.set(name, BlazeMine._OLDSTYLE_HELPER);
      if (! template._NOWARN_OLDSTYLE_HELPERS) {
        BlazeMine._warn('Assigning helper with `' + template.viewName + '.' +
                    name + ' = ...` is deprecated.  Use `' + template.viewName +
                    '.helpers(...)` instead.');
      }
    }
    if (template[name] != null) {
      return wrapHelper(bindDataContext(template[name]), tmplInstanceFunc);
    }
  }

  return null;
};

var wrapHelper = function (f, templateFunc) {
  if (typeof f !== "function") {
    return f;
  }

  return function () {
    var self = this;
    var args = arguments;

    return BlazeMine.Template._withTemplateInstanceFunc(templateFunc, function () {
      return BlazeMine._wrapCatchingExceptions(f, 'template helper').apply(self, args);
    });
  };
};

BlazeMine._lexicalBindingLookup = function (view, name) {
  var currentView = view;
  var blockHelpersStack = [];

  // walk up the views stopping at a Spacebars.include or Template view that
  // doesn't have an InOuterTemplateScope view as a parent
  do {
    // skip block helpers views
    // if we found the binding on the scope, return it
    if (_.has(currentView._scopeBindings, name)) {
      var bindingReactiveVar = currentView._scopeBindings[name];
      return function () {
        return bindingReactiveVar.get();
      };
    }
  } while (! (currentView.__startsNewLexicalScope &&
              ! (currentView.parentView &&
                 currentView.parentView.__childDoesntStartNewLexicalScope))
           && (currentView = currentView.parentView));

  return null;
};

// templateInstance argument is provided to be available for possible
// alternative implementations of this function by 3rd party packages.
BlazeMine._getTemplate = function (name, templateInstance) {
  if ((name in BlazeMine.Template) && (BlazeMine.Template[name] instanceof BlazeMine.Template)) {
    return BlazeMine.Template[name];
  }
  return null;
};

BlazeMine._getGlobalHelper = function (name, templateInstance) {
  if (BlazeMine._globalHelpers[name] != null) {
    return wrapHelper(bindDataContext(BlazeMine._globalHelpers[name]), templateInstance);
  }
  return null;
};



/**
 * @class
 * @summary Constructor for a View, which represents a reactive region of DOM.
 * @locus Client
 * @param {String} [name] Optional.  A name for this type of View.  See [`view.name`](#view_name).
 * @param {Function} renderFunction A function that returns [*renderable content*](#Renderable-Content).  In this function, `this` is bound to the View.
 */
BlazeMine.View = function (name, render) {
  if (! (this instanceof BlazeMine.View))
    // called without `new`
    return new BlazeMine.View(name, render);

  if (typeof name === 'function') {
    // omitted "name" argument
    render = name;
    name = '';
  }
  this.name = name;
  this._render = render;

  this._callbacks = {
    created: null,
    rendered: null,
    destroyed: null
  };

  // Setting all properties here is good for readability,
  // and also may help Chrome optimize the code by keeping
  // the View object from changing shape too much.
  this.isCreated = false;
  this._isCreatedForExpansion = false;
  this.isRendered = false;
  this._isAttached = false;
  this.isDestroyed = false;
  this._isInRender = false;
  this.parentView = null;
  this._domrange = null;
  // This flag is normally set to false except for the cases when view's parent
  // was generated as part of expanding some syntactic sugar expressions or
  // methods.
  // Ex.: BlazeMine.renderWithData is an equivalent to creating a view with regular
  // BlazeMine.render and wrapping it into {{#with data}}{{/with}} view. Since the
  // users don't know anything about these generated parent views, Blaze needs
  // this information to be available on views to make smarter decisions. For
  // example: removing the generated parent view with the view on BlazeMine.remove.
  this._hasGeneratedParent = false;
  // Bindings accessible to children views (via view.lookup('name')) within the
  // closest template view.
  this._scopeBindings = {};

  this.renderCount = 0;
};

// Looks up a name, like "foo" or "..", as a helper of the
// current template; the name of a template; a global helper;
// or a property of the data context.  Called on the View of
// a template (i.e. a View with a `.template` property,
// where the helpers are).  Used for the first name in a
// "path" in a template tag, like "foo" in `{{foo.bar}}` or
// ".." in `{{frobulate ../blah}}`.
//
// Returns a function, a non-function value, or null.  If
// a function is found, it is bound appropriately.
//
// NOTE: This function must not establish any reactive
// dependencies itself.  If there is any reactivity in the
// value, lookup should return a function.
BlazeMine.View.prototype.lookup = function (name, _options) {
  var template = this.template;
  var lookupTemplate = _options && _options.template;
  var helper;
  var binding;
  var boundTmplInstance;
  var foundTemplate;

  if (this.templateInstance) {
    boundTmplInstance = BlazeMine._bind(this.templateInstance, this);
  }

  // 0. looking up the parent data context with the special "../" syntax
  if (/^\./.test(name)) {
    // starts with a dot. must be a series of dots which maps to an
    // ancestor of the appropriate height.
    if (!/^(\.)+$/.test(name))
      throw new Error("id starting with dot must be a series of dots");

    return BlazeMine._parentData(name.length - 1, true /*_functionWrapped*/);

  }

  // 1. look up a helper on the current template
  if (template && ((helper = BlazeMine._getTemplateHelper(template, name, boundTmplInstance)) != null)) {
    return helper;
  }

  // 2. look up a binding by traversing the lexical view hierarchy inside the
  // current template
  if (template && (binding = BlazeMine._lexicalBindingLookup(BlazeMine.currentView, name)) != null) {
    return binding;
  }

  // 3. look up a template by name
  if (lookupTemplate && ((foundTemplate = BlazeMine._getTemplate(name, boundTmplInstance)) != null)) {
    return foundTemplate;
  }

  // 4. look up a global helper
  if ((helper = BlazeMine._getGlobalHelper(name, boundTmplInstance)) != null) {
    return helper;
  }

  const parentData =  _.isFunction(BlazeMine._parentData(1, true /*_functionWrapped*/)) ?  BlazeMine._parentData(1, true /*_functionWrapped*/)() : {}
  if (name === "hello") {
      console.log("Gandecki parentData", parentData);
  }
  // 5. look up in a data context
  return function () {
    var isCalledAsFunction = (arguments.length > 0);
    //
    var data = Object.assign({}, parentData, BlazeMine.getData());
    if (name === "hello") {
        console.log("Gandecki data", data);
        console.log("Gandecki name", name);
    }
    var x = data && data[name];
    if (! x) {
      if (lookupTemplate) {
        throw new Error("No such template: " + name);
      } else if (isCalledAsFunction) {
        throw new Error("No such function: " + name);
      } else if (name.charAt(0) === '@' && ((x === null) ||
                                            (x === undefined))) {
        // Throw an error if the user tries to use a `@directive`
        // that doesn't exist.  We don't implement all directives
        // from Handlebars, so there's a potential for confusion
        // if we fail silently.  On the other hand, we want to
        // throw late in case some app or package wants to provide
        // a missing directive.
        throw new Error("Unsupported directive: " + name);
      }
    }
    if (! data) {
      return null;
    }
    if (typeof x !== 'function') {
      if (isCalledAsFunction) {
        throw new Error("Can't call non-function: " + x);
      }
      return x;
    }
    return x.apply(data, arguments);
  };
};

// Implement Spacebars' {{../..}}.
// @param height {Number} The number of '..'s
BlazeMine._parentData = function (height, _functionWrapped) {
  // If height is null or undefined, we default to 1, the first parent.
  if (height == null) {
    height = 1;
  }
  var theWith = BlazeMine.getView('with');
  for (var i = 0; (i < height) && theWith; i++) {
    theWith = BlazeMine.getView(theWith, 'with');
  }

  if (! theWith)
    return null;
  if (_functionWrapped)
    return function () { return theWith.dataVar.get(); };
  return theWith.dataVar.get();
};


BlazeMine.View.prototype.lookupTemplate = function (name) {
  return this.lookup(name, {template:true});
};

BlazeMine._calculateCondition = function (cond) {
    if (cond instanceof Array && cond.length === 0)
        cond = false;
    return !! cond;
};

export default BlazeMine.With = function (data, contentFunc) {
  var view = BlazeMine.View('with', contentFunc);

  view.dataVar = {
    set(data) {
      this.data = data;
    },
    get() {
      return this.data;
    }
  };

  view.onViewCreated(function () {
    if (typeof data === 'function') {
      // `data` is a reactive function
      view.autorun(function () {
        view.dataVar.set(data());
      }, view.parentView, 'setData');
    } else {
      view.dataVar.set(data);
    }
  });

  return view;
};


/**
 * Attaches bindings to the instantiated view.
 * @param {Object} bindings A dictionary of bindings, each binding name
 * corresponds to a value or a function that will be reactively re-run.
 * @param {View} view The target.
 */
BlazeMine._attachBindingsToView = function (bindings, view) {
  view.onViewCreated(function () {
    _.each(bindings, function (binding, name) {
      view._scopeBindings[name] = new ReactiveVar;
      if (typeof binding === 'function') {
        view.autorun(function () {
          view._scopeBindings[name].set(binding());
        }, view.parentView);
      } else {
        view._scopeBindings[name].set(binding);
      }
    });
  });
};

/**
 * @summary Constructs a View setting the local lexical scope in the block.
 * @param {Function} bindings Dictionary mapping names of bindings to
 * values or computations to reactively re-run.
 * @param {Function} contentFunc A Function that returns [*renderable content*](#Renderable-Content).
 */
BlazeMine.Let = function (bindings, contentFunc) {
  var view = BlazeMine.View('let', contentFunc);
  BlazeMine._attachBindingsToView(bindings, view);

  return view;
};

/**
 * @summary Constructs a View that renders content conditionally.
 * @locus Client
 * @param {Function} conditionFunc A function to reactively re-run.  Whether the result is truthy or falsy determines whether `contentFunc` or `elseFunc` is shown.  An empty array is considered falsy.
 * @param {Function} contentFunc A Function that returns [*renderable content*](#Renderable-Content).
 * @param {Function} [elseFunc] Optional.  A Function that returns [*renderable content*](#Renderable-Content).  If no `elseFunc` is supplied, no content is shown in the "else" case.
 */
BlazeMine.If = function (conditionFunc, contentFunc, elseFunc, _not) {
  var conditionVar = new ReactiveVar;

  var view = BlazeMine.View(_not ? 'unless' : 'if', function () {
    return conditionVar.get() ? contentFunc() :
      (elseFunc ? elseFunc() : null);
  });
  view.__conditionVar = conditionVar;
  view.onViewCreated(function () {
    // this.autorun(function () {
      var cond = BlazeMine._calculateCondition(conditionFunc());
      conditionVar.set(_not ? (! cond) : cond);
    // }, this.parentView, 'condition');
  });

  return view;
};

/**
 * @summary An inverted [`BlazeMine.If`](#Blaze-If).
 * @locus Client
 * @param {Function} conditionFunc A function to reactively re-run.  If the result is falsy, `contentFunc` is shown, otherwise `elseFunc` is shown.  An empty array is considered falsy.
 * @param {Function} contentFunc A Function that returns [*renderable content*](#Renderable-Content).
 * @param {Function} [elseFunc] Optional.  A Function that returns [*renderable content*](#Renderable-Content).  If no `elseFunc` is supplied, no content is shown in the "else" case.
 */
BlazeMine.Unless = function (conditionFunc, contentFunc, elseFunc) {
  return BlazeMine.If(conditionFunc, contentFunc, elseFunc, true /*_not*/);
};


var warn = function () {
  if (ObserveSequence._suppressWarnings) {
    ObserveSequence._suppressWarnings--;
  } else {
    if (typeof console !== 'undefined' && console.warn)
      console.warn.apply(console, arguments);

    ObserveSequence._loggedWarnings++;
  }
};

// isArray returns true for arrays of these types:
// standard arrays: instanceof Array === true, _.isArray(arr) === true
// vm generated arrays: instanceOf Array === false, _.isArray(arr) === true
// subclassed arrays: instanceof Array === true, _.isArray(arr) === false
// see specific tests
function isArray(arr) {
  return arr instanceof Array || _.isArray(arr);
}

var idStringify = function() {
  // console.error("shouldnt be using this")
};

ObserveSequence = {
  _suppressWarnings: 0,
  _loggedWarnings: 0,

  // A mechanism similar to cursor.observe which receives a reactive
  // function returning a sequence type and firing appropriate callbacks
  // when the value changes.
  //
  // @param sequenceFunc {Function} a reactive function returning a
  //     sequence type. The currently supported sequence types are:
  //     Array, Cursor, and null.
  //
  // @param callbacks {Object} similar to a specific subset of
  //     callbacks passed to `cursor.observe`
  //     (http://docs.meteor.com/#observe), with minor variations to
  //     support the fact that not all sequences contain objects with
  //     _id fields.  Specifically:
  //
  //     * addedAt(id, item, atIndex, beforeId)
  //     * changedAt(id, newItem, oldItem, atIndex)
  //     * removedAt(id, oldItem, atIndex)
  //     * movedTo(id, item, fromIndex, toIndex, beforeId)
  //
  // @returns {Object(stop: Function)} call 'stop' on the return value
  //     to stop observing this sequence function.
  //
  // We don't make any assumptions about our ability to compare sequence
  // elements (ie, we don't assume EJSON.equals works; maybe there is extra
  // state/random methods on the objects) so unlike cursor.observe, we may
  // sometimes call changedAt() when nothing actually changed.
  // XXX consider if we *can* make the stronger assumption and avoid
  //     no-op changedAt calls (in some cases?)
  //
  // XXX currently only supports the callbacks used by our
  // implementation of {{#each}}, but this can be expanded.
  //
  // XXX #each doesn't use the indices (though we'll eventually need
  // a way to get them when we support `@index`), but calling
  // `cursor.observe` causes the index to be calculated on every
  // callback using a linear scan (unless you turn it off by passing
  // `_no_indices`).  Any way to avoid calculating indices on a pure
  // cursor observe like we used to?
  observe: function (sequenceFunc, callbacks) {
    var lastSeq = null;
    var activeObserveHandle = null;

    // 'lastSeqArray' contains the previous value of the sequence
    // we're observing. It is an array of objects with '_id' and
    // 'item' fields.  'item' is the element in the array, or the
    // document in the cursor.
    //
    // '_id' is whichever of the following is relevant, unless it has
    // already appeared -- in which case it's randomly generated.
    //
    // * if 'item' is an object:
    //   * an '_id' field, if present
    //   * otherwise, the index in the array
    //
    // * if 'item' is a number or string, use that value
    //
    // XXX this can be generalized by allowing {{#each}} to accept a
    // general 'key' argument which could be a function, a dotted
    // field name, or the special @index value.
    var lastSeqArray = []; // elements are objects of form {_id, item}

    var seq = sequenceFunc();

        var seqArray; // same structure as `lastSeqArray` above.

        if (activeObserveHandle) {
          // If we were previously observing a cursor, replace lastSeqArray with
          // more up-to-date information.  Then stop the old observe.
          lastSeqArray = _.map(lastSeq.fetch(), function (doc) {
            return {_id: doc._id, item: doc};
          });
          activeObserveHandle.stop();
          activeObserveHandle = null;
        }

        if (!seq) {
          seqArray = seqChangedToEmpty(lastSeqArray, callbacks);
        } else if (isArray(seq)) {
          seqArray = seqChangedToArray(lastSeqArray, seq, callbacks);
        } else if (isStoreCursor(seq)) {
          var result /* [seqArray, activeObserveHandle] */ =
                seqChangedToCursor(lastSeqArray, seq, callbacks);
          seqArray = result[0];
          activeObserveHandle = result[1];
        } else {
          throw badSequenceError();
        }

        // diffArray(lastSeqArray, seqArray, callbacks);
        lastSeq = seq;
        lastSeqArray = seqArray;

    return {
      stop: function () {
        if (activeObserveHandle)
          activeObserveHandle.stop();
      }
    };
  },

  // Fetch the items of `seq` into an array, where `seq` is of one of the
  // sequence types accepted by `observe`.  If `seq` is a cursor, a
  // dependency is established.
  fetch: function (seq) {
    if (!seq) {
      return [];
    } else if (isArray(seq)) {
      return seq;
    } else if (isStoreCursor(seq)) {
      return seq.fetch();
    } else {
      throw badSequenceError();
    }
  }
};

var badSequenceError = function () {
  return new Error("{{#each}} currently only accepts " +
                   "arrays, cursors or falsey values.");
};

var isStoreCursor = function (cursor) {
  return cursor && _.isObject(cursor) &&
    _.isFunction(cursor.observe) && _.isFunction(cursor.fetch);
};


seqChangedToEmpty = function (lastSeqArray, callbacks) {
  return [];
};

seqChangedToArray = function (lastSeqArray, array, callbacks) {
  var idsUsed = {};
  var seqArray = _.map(array, function (item, index) {
    var id;
    if (typeof item === 'string') {
      // ensure not empty, since other layers (eg DomRange) assume this as well
      id = "-" + item;
    } else if (typeof item === 'number' ||
               typeof item === 'boolean' ||
               item === undefined ||
               item === null) {
      id = item;
    } else if (typeof item === 'object') {
      id = (item && ('_id' in item)) ? item._id : index;
    } else {
      throw new Error("{{#each}} doesn't support arrays with " +
                      "elements of type " + typeof item);
    }

    var idString = idStringify(id);
    if (idsUsed[idString]) {
      if (item && typeof item === 'object' && '_id' in item)
        warn("duplicate id " + id + " in", array);
      id = `${Math.random()}`;
    } else {
      idsUsed[idString] = true;
    }
    return { _id: id, item: item };
  });
  return seqArray;
};

seqChangedToCursor = function (lastSeqArray, cursor, callbacks) {
  var initial = true; // are we observing initial data from cursor?
  var seqArray = [];

  var observeHandle = cursor.observe({
    addedAt: function (document, atIndex, before) {
      if (initial) {
        // keep track of initial data so that we can diff once
        // we exit `observe`.
        if (before !== null)
          throw new Error("Expected initial data from observe in order");
        seqArray.push({ _id: document._id, item: document });
      } else {
        callbacks.addedAt(document._id, document, atIndex, before);
      }
    },
    changedAt: function (newDocument, oldDocument, atIndex) {
      callbacks.changedAt(newDocument._id, newDocument, oldDocument,
                          atIndex);
    },
    removedAt: function (oldDocument, atIndex) {
      callbacks.removedAt(oldDocument._id, oldDocument, atIndex);
    },
    movedTo: function (document, fromIndex, toIndex, before) {
      callbacks.movedTo(
        document._id, document, fromIndex, toIndex, before);
    }
  });
  initial = false;

  return [seqArray, observeHandle];
};



/**
 * @summary Constructs a View that renders `contentFunc` for each item in a sequence.
 * @locus Client
 * @param {Function} argFunc A function to reactively re-run. The function can
 * return one of two options:
 *
 * 1. An object with two fields: '_variable' and '_sequence'. Each iterates over
 *   '_sequence', it may be a Cursor, an array, null, or undefined. Inside the
 *   Each body you will be able to get the current item from the sequence using
 *   the name specified in the '_variable' field.
 *
 * 2. Just a sequence (Cursor, array, null, or undefined) not wrapped into an
 *   object. Inside the Each body, the current item will be set as the data
 *   context.
 * @param {Function} contentFunc A Function that returns  [*renderable
 * content*](#Renderable-Content).
 * @param {Function} [elseFunc] A Function that returns [*renderable
 * content*](#Renderable-Content) to display in the case when there are no items
 * in the sequence.
 */
BlazeMine.Each = function (argFunc, contentFunc, elseFunc) {
  var eachView = BlazeMine.View('each', function () {
    var subviews = this.initialSubviews;
    this.initialSubviews = null;
    return subviews;
  });
  eachView.initialSubviews = [];
  eachView.numItems = 0;
  eachView.inElseMode = false;
  eachView.stopHandle = null;
  eachView.contentFunc = contentFunc;
  eachView.elseFunc = elseFunc;
  eachView.argVar = new ReactiveVar;
  eachView.variableName = null;

  // update the @index value in the scope of all subviews in the range
  var updateIndices = function (from, to) {
    if (to === undefined) {
      to = eachView.numItems - 1;
    }

    for (var i = from; i <= to; i++) {
      var view = eachView._domrange.members[i].view;
      view._scopeBindings['@index'].set(i);
    }
  };

  eachView.onViewCreated(function () {
    // We evaluate argFunc in an autorun to make sure
    // Blaze.currentView is always set when it runs (rather than
    // passing argFunc straight to ObserveSequence).
    // eachView.autorun(function () {
      // argFunc can return either a sequence as is or a wrapper object with a
      // _sequence and _variable fields set.
      var arg = argFunc();
      if (_.isObject(arg) && _.has(arg, '_sequence')) {
        eachView.variableName = arg._variable || null;
        arg = arg._sequence;
      }
      eachView.argVar.set(arg);
    // }, eachView.parentView, 'collection');


      eachView.argVar.get().forEach(function(item, index) {
          var newItemView;
          if (eachView.variableName) {
              // new-style #each (as in {{#each item in items}})
              // doesn't create a new data context
              newItemView = BlazeMine.View('item', eachView.contentFunc);
          } else {
              newItemView = BlazeMine.With(item, eachView.contentFunc);
          }

          eachView.numItems++;

          var bindings = {};
          bindings['@index'] = index;
          if (eachView.variableName) {
              bindings[eachView.variableName] = item;
          }
          BlazeMine._attachBindingsToView(bindings, newItemView);

          if (eachView.expandedValueDep) {
              eachView.expandedValueDep.changed();
          } else if (eachView._domrange) {
              if (eachView.inElseMode) {
                  eachView._domrange.removeMember(0);
                  eachView.inElseMode = false;
              }

              var range = BlazeMine._materializeView(newItemView, eachView);
              eachView._domrange.addMember(range, index);
              updateIndices(index);
          } else {
              eachView.initialSubviews.splice(index, 0, newItemView);
          }
      })
    eachView.stopHandle = ObserveSequence.observe(function () {
      return eachView.argVar.get();
    }, {
      // addedAt: function (id, item, index) {
      //   Tracker.nonreactive(function () {
      //     var newItemView;
      //     if (eachView.variableName) {
      //       // new-style #each (as in {{#each item in items}})
      //       // doesn't create a new data context
      //       newItemView = BlazeMine.View('item', eachView.contentFunc);
      //     } else {
      //       newItemView = BlazeMine.With(item, eachView.contentFunc);
      //     }
      //
      //     eachView.numItems++;
      //
      //     var bindings = {};
      //     bindings['@index'] = index;
      //     if (eachView.variableName) {
      //       bindings[eachView.variableName] = item;
      //     }
      //     BlazeMine._attachBindingsToView(bindings, newItemView);
      //
      //     if (eachView.expandedValueDep) {
      //       eachView.expandedValueDep.changed();
      //     } else if (eachView._domrange) {
      //       if (eachView.inElseMode) {
      //         eachView._domrange.removeMember(0);
      //         eachView.inElseMode = false;
      //       }
      //
      //       var range = BlazeMine._materializeView(newItemView, eachView);
      //       eachView._domrange.addMember(range, index);
      //       updateIndices(index);
      //     } else {
      //       eachView.initialSubviews.splice(index, 0, newItemView);
      //     }
      //   });
      // },
      // removedAt: function (id, item, index) {
      //   Tracker.nonreactive(function () {
      //     eachView.numItems--;
      //     if (eachView.expandedValueDep) {
      //       eachView.expandedValueDep.changed();
      //     } else if (eachView._domrange) {
      //       eachView._domrange.removeMember(index);
      //       updateIndices(index);
      //       if (eachView.elseFunc && eachView.numItems === 0) {
      //         eachView.inElseMode = true;
      //         eachView._domrange.addMember(
      //           BlazeMine._materializeView(
      //             BlazeMine.View('each_else',eachView.elseFunc),
      //             eachView), 0);
      //       }
      //     } else {
      //       eachView.initialSubviews.splice(index, 1);
      //     }
      //   });
      // },
      // changedAt: function (id, newItem, oldItem, index) {
      //   Tracker.nonreactive(function () {
      //     if (eachView.expandedValueDep) {
      //       eachView.expandedValueDep.changed();
      //     } else {
      //       var itemView;
      //       if (eachView._domrange) {
      //         itemView = eachView._domrange.getMember(index).view;
      //       } else {
      //         itemView = eachView.initialSubviews[index];
      //       }
      //       if (eachView.variableName) {
      //         itemView._scopeBindings[eachView.variableName].set(newItem);
      //       } else {
      //         itemView.dataVar.set(newItem);
      //       }
      //     }
      //   });
      // },
      // movedTo: function (id, item, fromIndex, toIndex) {
      //   Tracker.nonreactive(function () {
      //     if (eachView.expandedValueDep) {
      //       eachView.expandedValueDep.changed();
      //     } else if (eachView._domrange) {
      //       eachView._domrange.moveMember(fromIndex, toIndex);
      //       updateIndices(
      //         Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex));
      //     } else {
      //       var subviews = eachView.initialSubviews;
      //       var itemView = subviews[fromIndex];
      //       subviews.splice(fromIndex, 1);
      //       subviews.splice(toIndex, 0, itemView);
      //     }
      //   });
      // }
    });

    if (eachView.elseFunc && eachView.numItems === 0) {
      eachView.inElseMode = true;
      eachView.initialSubviews[0] =
        BlazeMine.View('each_else', eachView.elseFunc);
    }
  });

  eachView.onViewDestroyed(function () {
    if (eachView.stopHandle)
      eachView.stopHandle.stop();
  });

  return eachView;
};


/// [new] BlazeMine.View([name], renderMethod)
///
/// BlazeMine.View is the building block of reactive DOM.  Views have
/// the following features:
///
/// * lifecycle callbacks - Views are created, rendered, and destroyed,
///   and callbacks can be registered to fire when these things happen.
///
/// * parent pointer - A View points to its parentView, which is the
///   View that caused it to be rendered.  These pointers form a
///   hierarchy or tree of Views.
///
/// * render() method - A View's render() method specifies the DOM
///   (or HTML) content of the View.  If the method establishes
///   reactive dependencies, it may be re-run.
///
/// * a DOMRange - If a View is rendered to DOM, its position and
///   extent in the DOM are tracked using ar DOMRange object.
///
/// When a View is constructed by calling BlazeMine.View, the View is
/// not yet considered "created."  It doesn't have a parentView yet,
/// and no logic has been run to initialize the View.  All real
/// work is deferred until at least creation time, when the onViewCreated
/// callbacks are fired, which happens when the View is "used" in
/// some way that requires it to be rendered.
///
/// ...more lifecycle stuff
///
/// `name` is an optional string tag identifying the View.  The only
/// time it's used is when looking in the View tree for a View of a
/// particular name; for example, data contexts are stored on Views
/// of name "with".  Names are also useful when debugging, so in
/// general it's good for functions that create Views to set the name.
/// Views associated with templates have names of the form "Template.foo".


BlazeMine.View.prototype._render = function () { return null; };

BlazeMine.View.prototype.onViewCreated = function (cb) {
  this._callbacks.created = this._callbacks.created || [];
  this._callbacks.created.push(cb);
};

BlazeMine.View.prototype._onViewRendered = function (cb) {
  this._callbacks.rendered = this._callbacks.rendered || [];
  this._callbacks.rendered.push(cb);
};

BlazeMine.View.prototype.onViewReady = function (cb) {
  var self = this;
  var fire = function () {
    Tracker.afterFlush(function () {
      if (! self.isDestroyed) {
        BlazeMine._withCurrentView(self, function () {
          cb.call(self);
        });
      }
    });
  };
  self._onViewRendered(function onViewRendered() {
    if (self.isDestroyed)
      return;
    if (! self._domrange.attached)
      self._domrange.onAttached(fire);
    else
      fire();
  });
};

BlazeMine.View.prototype.onViewDestroyed = function (cb) {
  this._callbacks.destroyed = this._callbacks.destroyed || [];
  this._callbacks.destroyed.push(cb);
};
BlazeMine.View.prototype.removeViewDestroyedListener = function (cb) {
  var destroyed = this._callbacks.destroyed;
  if (! destroyed)
    return;
  var index = _.lastIndexOf(destroyed, cb);
  if (index !== -1) {
    // XXX You'd think the right thing to do would be splice, but _fireCallbacks
    // gets sad if you remove callbacks while iterating over the list.  Should
    // change this to use callback-hook or EventEmitter or something else that
    // properly supports removal.
    destroyed[index] = null;
  }
};

/// View#autorun(func)
///
/// Sets up a Tracker autorun that is "scoped" to this View in two
/// important ways: 1) BlazeMine.currentView is automatically set
/// on every re-run, and 2) the autorun is stopped when the
/// View is destroyed.  As with Tracker.autorun, the first run of
/// the function is immediate, and a Computation object that can
/// be used to stop the autorun is returned.
///
/// View#autorun is meant to be called from View callbacks like
/// onViewCreated, or from outside the rendering process.  It may not
/// be called before the onViewCreated callbacks are fired (too early),
/// or from a render() method (too confusing).
///
/// Typically, autoruns that update the state
/// of the View (as in BlazeMine.With) should be started from an onViewCreated
/// callback.  Autoruns that update the DOM should be started
/// from either onViewCreated (guarded against the absence of
/// view._domrange), or onViewReady.
BlazeMine.View.prototype.autorun = function (f, _inViewScope, displayName) {
  return;
  var self = this;

  // // The restrictions on when View#autorun can be called are in order
  // // to avoid bad patterns, like creating a BlazeMine.View and immediately
  // // calling autorun on it.  A freshly created View is not ready to
  // // have logic run on it; it doesn't have a parentView, for example.
  // // It's when the View is materialized or expanded that the onViewCreated
  // // handlers are fired and the View starts up.
  // //
  // // Letting the render() method call `this.autorun()` is problematic
  // // because of re-render.  The best we can do is to stop the old
  // // autorun and start a new one for each render, but that's a pattern
  // // we try to avoid internally because it leads to helpers being
  // // called extra times, in the case where the autorun causes the
  // // view to re-render (and thus the autorun to be torn down and a
  // // new one established).
  // //
  // // We could lift these restrictions in various ways.  One interesting
  // // idea is to allow you to call `view.autorun` after instantiating
  // // `view`, and automatically wrap it in `view.onViewCreated`, deferring
  // // the autorun so that it starts at an appropriate time.  However,
  // // then we can't return the Computation object to the caller, because
  // // it doesn't exist yet.
  // if (! self.isCreated) {
  //   throw new Error("View#autorun must be called from the created callback at the earliest");
  // }
  // if (this._isInRender) {
  //   throw new Error("Can't call View#autorun from inside render(); try calling it from the created or rendered callback");
  // }

  var templateInstanceFunc = BlazeMine.Template._currentTemplateInstanceFunc;

  var func = function viewAutorun(c) {
    return BlazeMine._withCurrentView(_inViewScope || self, function () {
      return BlazeMine.Template._withTemplateInstanceFunc(
        templateInstanceFunc, function () {
          return f.call(self, c);
        });
    });
  };

  // Give the autorun function a better name for debugging and profiling.
  // The `displayName` property is not part of the spec but browsers like Chrome
  // and Firefox prefer it in debuggers over the name function was declared by.
  func.displayName =
    (self.name || 'anonymous') + ':' + (displayName || 'anonymous');
  var comp = Tracker.autorun(func);

  var stopComputation = function () { comp.stop(); };
  self.onViewDestroyed(stopComputation);
  comp.onStop(function () {
    self.removeViewDestroyedListener(stopComputation);
  });

  return comp;
};

BlazeMine.View.prototype._errorIfShouldntCallSubscribe = function () {
  var self = this;

  if (! self.isCreated) {
    throw new Error("View#subscribe must be called from the created callback at the earliest");
  }
  if (self._isInRender) {
    throw new Error("Can't call View#subscribe from inside render(); try calling it from the created or rendered callback");
  }
  if (self.isDestroyed) {
    throw new Error("Can't call View#subscribe from inside the destroyed callback, try calling it inside created or rendered.");
  }
};

/**
 * Just like BlazeMine.View#autorun, but with Meteor.subscribe instead of
 * Tracker.autorun. Stop the subscription when the view is destroyed.
 * @return {SubscriptionHandle} A handle to the subscription so that you can
 * see if it is ready, or stop it manually
 */
BlazeMine.View.prototype.subscribe = function (args, options) {
  var self = this;
  options = options || {};

  self._errorIfShouldntCallSubscribe();

  var subHandle;
  if (options.connection) {
    subHandle = options.connection.subscribe.apply(options.connection, args);
  } else {
    subHandle = Meteor.subscribe.apply(Meteor, args);
  }

  self.onViewDestroyed(function () {
    subHandle.stop();
  });

  return subHandle;
};

BlazeMine.View.prototype.firstNode = function () {
  if (! this._isAttached)
    throw new Error("View must be attached before accessing its DOM");

  return this._domrange.firstNode();
};

BlazeMine.View.prototype.lastNode = function () {
  if (! this._isAttached)
    throw new Error("View must be attached before accessing its DOM");

  return this._domrange.lastNode();
};

BlazeMine._fireCallbacks = function (view, which) {
  BlazeMine._withCurrentView(view, function () {
    // Tracker.nonreactive(function fireCallbacks() {
      var cbs = view._callbacks[which];
      for (var i = 0, N = (cbs && cbs.length); i < N; i++)
        cbs[i] && cbs[i].call(view);
    // });
  });
};

BlazeMine._createView = function (view, parentView, forExpansion) {
  if (view.isCreated)
    throw new Error("Can't render the same View twice");

  view.parentView = (parentView || null);
  view.isCreated = true;
  if (forExpansion)
    view._isCreatedForExpansion = true;

  BlazeMine._fireCallbacks(view, 'created');
};

var doFirstRender = function (view, initialContent) {
  var domrange = new BlazeMine._DOMRange(initialContent);
  view._domrange = domrange;
  domrange.view = view;
  view.isRendered = true;
  BlazeMine._fireCallbacks(view, 'rendered');

  var teardownHook = null;

  domrange.onAttached(function attached(range, element) {
    view._isAttached = true;

    teardownHook = BlazeMine._DOMBackend.Teardown.onElementTeardown(
      element, function teardown() {
        BlazeMine._destroyView(view, true /* _skipNodes */);
      });
  });

  // tear down the teardown hook
  view.onViewDestroyed(function () {
    teardownHook && teardownHook.stop();
    teardownHook = null;
  });

  return domrange;
};

// Take an uncreated View `view` and create and render it to DOM,
// setting up the autorun that updates the View.  Returns a new
// DOMRange, which has been associated with the View.
//
// The private arguments `_workStack` and `_intoArray` are passed in
// by BlazeMine._materializeDOM and are only present for recursive calls
// (when there is some other _materializeView on the stack).  If
// provided, then we avoid the mutual recursion of calling back into
// BlazeMine._materializeDOM so that deep View hierarchies don't blow the
// stack.  Instead, we push tasks onto workStack for the initial
// rendering and subsequent setup of the View, and they are done after
// we return.  When there is a _workStack, we do not return the new
// DOMRange, but instead push it into _intoArray from a _workStack
// task.
BlazeMine._materializeView = function (view, parentView, _workStack, _intoArray) {
  BlazeMine._createView(view, parentView);

  var domrange;
  var lastHtmljs;
  // We don't expect to be called in a Computation, but just in case,
  // wrap in Tracker.nonreactive.
  Tracker.nonreactive(function () {
    view.autorun(function doRender(c) {
      // `view.autorun` sets the current view.
      view.renderCount++;
      view._isInRender = true;
      // Any dependencies that should invalidate this Computation come
      // from this line:
      var htmljs = view._render();
      view._isInRender = false;

      if (! c.firstRun && ! BlazeMine._isContentEqual(lastHtmljs, htmljs)) {
        Tracker.nonreactive(function doMaterialize() {
          // re-render
          var rangesAndNodes = BlazeMine._materializeDOM(htmljs, [], view);
          domrange.setMembers(rangesAndNodes);
          BlazeMine._fireCallbacks(view, 'rendered');
        });
      }
      lastHtmljs = htmljs;

      // Causes any nested views to stop immediately, not when we call
      // `setMembers` the next time around the autorun.  Otherwise,
      // helpers in the DOM tree to be replaced might be scheduled
      // to re-run before we have a chance to stop them.
      Tracker.onInvalidate(function () {
        if (domrange) {
          domrange.destroyMembers();
        }
      });
    }, undefined, 'materialize');

    // first render.  lastHtmljs is the first htmljs.
    var initialContents;
    if (! _workStack) {
      initialContents = BlazeMine._materializeDOM(lastHtmljs, [], view);
      domrange = doFirstRender(view, initialContents);
      initialContents = null; // help GC because we close over this scope a lot
    } else {
      // We're being called from BlazeMine._materializeDOM, so to avoid
      // recursion and save stack space, provide a description of the
      // work to be done instead of doing it.  Tasks pushed onto
      // _workStack will be done in LIFO order after we return.
      // The work will still be done within a Tracker.nonreactive,
      // because it will be done by some call to BlazeMine._materializeDOM
      // (which is always called in a Tracker.nonreactive).
      initialContents = [];
      // push this function first so that it happens last
      _workStack.push(function () {
        domrange = doFirstRender(view, initialContents);
        initialContents = null; // help GC because of all the closures here
        _intoArray.push(domrange);
      });
      // now push the task that calculates initialContents
      _workStack.push(BlazeMine._bind(BlazeMine._materializeDOM, null,
                             lastHtmljs, initialContents, view, _workStack));
    }
  });

  if (! _workStack) {
    return domrange;
  } else {
    return null;
  }
};

// Expands a View to HTMLjs, calling `render` recursively on all
// Views and evaluating any dynamic attributes.  Calls the `created`
// callback, but not the `materialized` or `rendered` callbacks.
// Destroys the view immediately, unless called in a Tracker Computation,
// in which case the view will be destroyed when the Computation is
// invalidated.  If called in a Tracker Computation, the result is a
// reactive string; that is, the Computation will be invalidated
// if any changes are made to the view or subviews that might affect
// the HTMLMine.
BlazeMine._expandView = function (view, parentView) {
  BlazeMine._createView(view, parentView, true /*forExpansion*/);

  view._isInRender = true;
  var htmljs = BlazeMine._withCurrentView(view, function () {
    return view._render();
  });
  view._isInRender = false;

  var result = BlazeMine._expand(htmljs, view);


    BlazeMine._destroyView(view);
  // }

  return result;
};

// Options: `parentView`
BlazeMine._HTMLJSExpander = HTMLMine.TransformingVisitor.extend();
BlazeMine._HTMLJSExpander.def({
  visitObject: function (x) {
    if (x instanceof BlazeMine.View)
      return BlazeMine._expandView(x, this.parentView);

    // this will throw an error; other objects are not allowed!
    return HTMLMine.TransformingVisitor.prototype.visitObject.call(this, x);
  },
  visitAttributes: function (attrs) {
    // expand dynamic attributes
    if (typeof attrs === 'function')
      attrs = BlazeMine._withCurrentView(this.parentView, attrs);

    // call super (e.g. for case where `attrs` is an array)
    return HTMLMine.TransformingVisitor.prototype.visitAttributes.call(this, attrs);
  },
  visitAttribute: function (name, value, tag) {
    // expand attribute values that are functions.  Any attribute value
    // that contains Views must be wrapped in a function.
    if (typeof value === 'function')
      value = BlazeMine._withCurrentView(this.parentView, value);

    return HTMLMine.TransformingVisitor.prototype.visitAttribute.call(
      this, name, value, tag);
  }
});

// Return BlazeMine.currentView, but only if it is being rendered
// (i.e. we are in its render() method).
var currentViewIfRendering = function () {
  var view = BlazeMine.currentView;
  return (view && view._isInRender) ? view : null;
};

BlazeMine._expand = function (htmljs, parentView) {
  parentView = parentView || currentViewIfRendering();
  return (new BlazeMine._HTMLJSExpander(
    {parentView: parentView})).visit(htmljs);
};

BlazeMine._expandAttributes = function (attrs, parentView) {
  parentView = parentView || currentViewIfRendering();
  return (new BlazeMine._HTMLJSExpander(
    {parentView: parentView})).visitAttributes(attrs);
};

BlazeMine._destroyView = function (view, _skipNodes) {
  if (view.isDestroyed)
    return;
  view.isDestroyed = true;

  BlazeMine._fireCallbacks(view, 'destroyed');

  // Destroy views and elements recursively.  If _skipNodes,
  // only recurse up to views, not elements, for the case where
  // the backend (jQuery) is recursing over the elements already.

  if (view._domrange)
    view._domrange.destroyMembers(_skipNodes);
};

BlazeMine._destroyNode = function (node) {
  if (node.nodeType === 1)
    BlazeMine._DOMBackend.Teardown.tearDownElement(node);
};

// Are the HTMLjs entities `a` and `b` the same?  We could be
// more elaborate here but the point is to catch the most basic
// cases.
BlazeMine._isContentEqual = function (a, b) {
  if (a instanceof HTMLMine.Raw) {
    return (b instanceof HTMLMine.Raw) && (a.value === b.value);
  } else if (a == null) {
    return (b == null);
  } else {
    return (a === b) &&
      ((typeof a === 'number') || (typeof a === 'boolean') ||
       (typeof a === 'string'));
  }
};

/**
 * @summary The View corresponding to the current template helper, event handler, callback, or autorun.  If there isn't one, `null`.
 * @locus Client
 * @type {BlazeMine.View}
 */
BlazeMine.currentView = null;

BlazeMine._withCurrentView = function (view, func) {
  var oldView = BlazeMine.currentView;
  try {
    BlazeMine.currentView = view;
    return func();
  } finally {
    BlazeMine.currentView = oldView;
  }
};

// BlazeMine.render publicly takes a View or a Template.
// Privately, it takes any HTMLJS (extended with Views and Templates)
// except null or undefined, or a function that returns any extended
// HTMLJS.
var checkRenderContent = function (content) {
  if (content === null)
    throw new Error("Can't render null");
  if (typeof content === 'undefined')
    throw new Error("Can't render undefined");

  if ((content instanceof BlazeMine.View) ||
      (content instanceof BlazeMine.Template) ||
      (typeof content === 'function'))
    return;

  try {
    // Throw if content doesn't look like HTMLJS at the top level
    // (i.e. verify that this is an HTMLMine.Tag, or an array,
    // or a primitive, etc.)
    (new HTMLMine.Visitor).visit(content);
  } catch (e) {
    // Make error message suitable for public API
    throw new Error("Expected Template or View");
  }
};

// For BlazeMine.render and BlazeMine.toHTML, take content and
// wrap it in a View, unless it's a single View or
// Template already.
var contentAsView = function (content) {
  checkRenderContent(content);

if (content instanceof BlazeMine.View) {
    return content;
  } else {
    var func = content;
    if (typeof func !== 'function') {
      func = function () {
        return content;
      };
    }
    return BlazeMine.View('render', func);
  }
};

// For BlazeMine.renderWithData and BlazeMine.toHTMLWithData, wrap content
// in a function, if necessary, so it can be a content arg to
// a BlazeMine.With.
var contentAsFunc = function (content) {
  checkRenderContent(content);

  if (typeof content !== 'function') {
    return function () {
      return content;
    };
  } else {
    return content;
  }
};

/**
 * @summary Renders a template or View to DOM nodes and inserts it into the DOM, returning a rendered [View](#Blaze-View) which can be passed to [`BlazeMine.remove`](#Blaze-remove).
 * @locus Client
 * @param {Template|BlazeMine.View} templateOrView The template (e.g. `Template.myTemplate`) or View object to render.  If a template, a View object is [constructed](#template_constructview).  If a View, it must be an unrendered View, which becomes a rendered View and is returned.
 * @param {DOMNode} parentNode The node that will be the parent of the rendered template.  It must be an Element node.
 * @param {DOMNode} [nextNode] Optional. If provided, must be a child of <em>parentNode</em>; the template will be inserted before this node. If not provided, the template will be inserted as the last child of parentNode.
 * @param {BlazeMine.View} [parentView] Optional. If provided, it will be set as the rendered View's [`parentView`](#view_parentview).
 */
BlazeMine.render = function (content, parentElement, nextNode, parentView) {
  if (! parentElement) {
    BlazeMine._warn("BlazeMine.render without a parent element is deprecated. " +
                "You must specify where to insert the rendered content.");
  }

  if (nextNode instanceof BlazeMine.View) {
    // handle omitted nextNode
    parentView = nextNode;
    nextNode = null;
  }

  // parentElement must be a DOM node. in particular, can't be the
  // result of a call to `$`. Can't check if `parentElement instanceof
  // Node` since 'Node' is undefined in IE8.
  if (parentElement && typeof parentElement.nodeType !== 'number')
    throw new Error("'parentElement' must be a DOM node");
  if (nextNode && typeof nextNode.nodeType !== 'number') // 'nextNode' is optional
    throw new Error("'nextNode' must be a DOM node");

  parentView = parentView || currentViewIfRendering();

  var view = contentAsView(content);
  BlazeMine._materializeView(view, parentView);

  if (parentElement) {
    view._domrange.attach(parentElement, nextNode);
  }

  return view;
};

BlazeMine.insert = function (view, parentElement, nextNode) {
  BlazeMine._warn("BlazeMine.insert has been deprecated.  Specify where to insert the " +
              "rendered content in the call to BlazeMine.render.");

  if (! (view && (view._domrange instanceof BlazeMine._DOMRange)))
    throw new Error("Expected template rendered with BlazeMine.render");

  view._domrange.attach(parentElement, nextNode);
};

/**
 * @summary Renders a template or View to DOM nodes with a data context.  Otherwise identical to `BlazeMine.render`.
 * @locus Client
 * @param {Template|BlazeMine.View} templateOrView The template (e.g. `Template.myTemplate`) or View object to render.
 * @param {Object|Function} data The data context to use, or a function returning a data context.  If a function is provided, it will be reactively re-run.
 * @param {DOMNode} parentNode The node that will be the parent of the rendered template.  It must be an Element node.
 * @param {DOMNode} [nextNode] Optional. If provided, must be a child of <em>parentNode</em>; the template will be inserted before this node. If not provided, the template will be inserted as the last child of parentNode.
 * @param {BlazeMine.View} [parentView] Optional. If provided, it will be set as the rendered View's [`parentView`](#view_parentview).
 */
BlazeMine.renderWithData = function (content, data, parentElement, nextNode, parentView) {
  // We defer the handling of optional arguments to BlazeMine.render.  At this point,
  // `nextNode` may actually be `parentView`.
  return BlazeMine.render(BlazeMine._TemplateWith(data, contentAsFunc(content)),
                          parentElement, nextNode, parentView);
};

/**
 * @summary Removes a rendered View from the DOM, stopping all reactive updates and event listeners on it. Also destroys the BlazeMine.Template instance associated with the view.
 * @locus Client
 * @param {BlazeMine.View} renderedView The return value from `BlazeMine.render` or `BlazeMine.renderWithData`, or the `view` property of a BlazeMine.Template instance. Calling `BlazeMine.remove(Template.instance().view)` from within a template event handler will destroy the view as well as that template and trigger the template's `onDestroyed` handlers.
 */
BlazeMine.remove = function (view) {
  if (! (view && (view._domrange instanceof BlazeMine._DOMRange)))
    throw new Error("Expected template rendered with BlazeMine.render");

  while (view) {
    if (! view.isDestroyed) {
      var range = view._domrange;
      if (range.attached && ! range.parentRange)
        range.detach();
      range.destroy();
    }

    view = view._hasGeneratedParent && view.parentView;
  }
};

/**
 * @summary Renders a template or View to a string of HTMLMine.
 * @locus Client
 * @param {Template|BlazeMine.View} templateOrView The template (e.g. `Template.myTemplate`) or View object from which to generate HTMLMine.
 */
BlazeMine.toHTML = function (content, parentView) {
  parentView = parentView || currentViewIfRendering();

  return HTMLMine.toHTML(BlazeMine._expandView(contentAsView(content), parentView));
};

/**
 * @summary Renders a template or View to HTML with a data context.  Otherwise identical to `BlazeMine.toHTML`.
 * @locus Client
 * @param {Template|BlazeMine.View} templateOrView The template (e.g. `Template.myTemplate`) or View object from which to generate HTMLMine.
 * @param {Object|Function} data The data context to use, or a function returning a data context.
 */
BlazeMine.toHTMLWithData = function (content, data, parentView) {
  parentView = parentView || currentViewIfRendering();

  return HTMLMine.toHTML(BlazeMine._expandView(BlazeMine._TemplateWith(
    data, contentAsFunc(content)), parentView));
};

BlazeMine._toText = function (htmljs, parentView, textMode) {
  if (typeof htmljs === 'function')
    throw new Error("BlazeMine._toText doesn't take a function, just HTMLjs");

  if ((parentView != null) && ! (parentView instanceof BlazeMine.View)) {
    // omitted parentView argument
    textMode = parentView;
    parentView = null;
  }
  parentView = parentView || currentViewIfRendering();

  if (! textMode)
    throw new Error("textMode required");
  if (! (textMode === HTMLMine.TEXTMODE.STRING ||
         textMode === HTMLMine.TEXTMODE.RCDATA ||
         textMode === HTMLMine.TEXTMODE.ATTRIBUTE))
    throw new Error("Unknown textMode: " + textMode);

  return HTMLMine.toText(BlazeMine._expand(htmljs, parentView), textMode);
};

/**
 * @summary Returns the current data context, or the data context that was used when rendering a particular DOM element or View from a Meteor template.
 * @locus Client
 * @param {DOMElement|BlazeMine.View} [elementOrView] Optional.  An element that was rendered by a Meteor, or a View.
 */
BlazeMine.getData = function (elementOrView) {
  var theWith;

  if (! elementOrView) {
    theWith = BlazeMine.getView('with');
  } else if (elementOrView instanceof BlazeMine.View) {
    var view = elementOrView;
    theWith = (view.name === 'with' ? view :
               BlazeMine.getView(view, 'with'));
  } else if (typeof elementOrView.nodeType === 'number') {
    if (elementOrView.nodeType !== 1)
      throw new Error("Expected DOM element");
    theWith = BlazeMine.getView(elementOrView, 'with');
  } else {
    throw new Error("Expected DOM element or View");
  }

  return theWith ? theWith.dataVar.get() : null;
};

// For back-compat
BlazeMine.getElementData = function (element) {
  BlazeMine._warn("BlazeMine.getElementData has been deprecated.  Use " +
              "BlazeMine.getData(element) instead.");

  if (element.nodeType !== 1)
    throw new Error("Expected DOM element");

  return BlazeMine.getData(element);
};

// Both arguments are optional.

/**
 * @summary Gets either the current View, or the View enclosing the given DOM element.
 * @locus Client
 * @param {DOMElement} [element] Optional.  If specified, the View enclosing `element` is returned.
 */
BlazeMine.getView = function (elementOrView, _viewName) {
  var viewName = _viewName;

  if ((typeof elementOrView) === 'string') {
    // omitted elementOrView; viewName present
    viewName = elementOrView;
    elementOrView = null;
  }

  // We could eventually shorten the code by folding the logic
  // from the other methods into this method.
  if (! elementOrView) {
    return BlazeMine._getCurrentView(viewName);
  } else if (elementOrView instanceof BlazeMine.View) {
    return BlazeMine._getParentView(elementOrView, viewName);
  } else if (typeof elementOrView.nodeType === 'number') {
    return BlazeMine._getElementView(elementOrView, viewName);
  } else {
    throw new Error("Expected DOM element or View");
  }
};

// Gets the current view or its nearest ancestor of name
// `name`.
BlazeMine._getCurrentView = function (name) {
  var view = BlazeMine.currentView;
  // Better to fail in cases where it doesn't make sense
  // to use BlazeMine._getCurrentView().  There will be a current
  // view anywhere it does.  You can check BlazeMine.currentView
  // if you want to know whether there is one or not.
  if (! view)
    throw new Error("There is no current view");

  if (name) {
    while (view && view.name !== name)
      view = view.parentView;
    return view || null;
  } else {
    // BlazeMine._getCurrentView() with no arguments just returns
    // BlazeMine.currentView.
    return view;
  }
};

BlazeMine._getParentView = function (view, name) {
  var v = view.parentView;

  if (name) {
    while (v && v.name !== name)
      v = v.parentView;
  }

  return v || null;
};

BlazeMine._getElementView = function (elem, name) {
  var range = BlazeMine._DOMRange.forElement(elem);
  var view = null;
  while (range && ! view) {
    view = (range.view || null);
    if (! view) {
      if (range.parentRange)
        range = range.parentRange;
      else
        range = BlazeMine._DOMRange.forElement(range.parentElement);
    }
  }

  if (name) {
    while (view && view.name !== name)
      view = view.parentView;
    return view || null;
  } else {
    return view;
  }
};

BlazeMine._addEventMap = function (view, eventMap, thisInHandler) {
  thisInHandler = (thisInHandler || null);
  var handles = [];

  if (! view._domrange)
    throw new Error("View must have a DOMRange");

  view._domrange.onAttached(function attached_eventMaps(range, element) {
    _.each(eventMap, function (handler, spec) {
      var clauses = spec.split(/,\s+/);
      // iterate over clauses of spec, e.g. ['click .foo', 'click .bar']
      _.each(clauses, function (clause) {
        var parts = clause.split(/\s+/);
        if (parts.length === 0)
          return;

        var newEvents = parts.shift();
        var selector = parts.join(' ');
        handles.push(BlazeMine._EventSupport.listen(
          element, newEvents, selector,
          function (evt) {
            if (! range.containsElement(evt.currentTarget))
              return null;
            var handlerThis = thisInHandler || this;
            var handlerArgs = arguments;
            return BlazeMine._withCurrentView(view, function () {
              return handler.apply(handlerThis, handlerArgs);
            });
          },
          range, function (r) {
            return r.parentRange;
          }));
      });
    });
  });

  view.onViewDestroyed(function () {
    _.each(handles, function (h) {
      h.stop();
    });
    handles.length = 0;
  });
};
