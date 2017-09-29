HTMLMine = {};

IDENTITY = function (x) { return x; };
SLICE = Array.prototype.slice;



HTMLMine.Tag = function () {};
HTMLMine.Tag.prototype.tagName = ''; // this will be set per Tag subclass
HTMLMine.Tag.prototype.attrs = null;
HTMLMine.Tag.prototype.children = Object.freeze ? Object.freeze([]) : [];
HTMLMine.Tag.prototype.htmljsType = HTMLMine.Tag.htmljsType = ['Tag'];

// Given "p" create the function `HTMLMine.P`.
var makeTagConstructor = function (tagName) {
  // HTMLTag is the per-tagName constructor of a HTMLMine.Tag subclass
  var HTMLTag = function (/*arguments*/) {
    // Work with or without `new`.  If not called with `new`,
    // perform instantiation by recursively calling this constructor.
    // We can't pass varargs, so pass no args.
    var instance = (this instanceof HTMLMine.Tag) ? this : new HTMLTag;

    var i = 0;
    var attrs = arguments.length && arguments[0];
    if (attrs && (typeof attrs === 'object')) {
      // Treat vanilla JS object as an attributes dictionary.
      if (! HTMLMine.isConstructedObject(attrs)) {
        instance.attrs = attrs;
        i++;
      } else if (attrs instanceof HTMLMine.Attrs) {
        var array = attrs.value;
        if (array.length === 1) {
          instance.attrs = array[0];
        } else if (array.length > 1) {
          instance.attrs = array;
        }
        i++;
      }
    }


    // If no children, don't create an array at all, use the prototype's
    // (frozen, empty) array.  This way we don't create an empty array
    // every time someone creates a tag without `new` and this constructor
    // calls itself with no arguments (above).
    if (i < arguments.length)
      instance.children = SLICE.call(arguments, i);

    return instance;
  };
  HTMLTag.prototype = new HTMLMine.Tag;
  HTMLTag.prototype.constructor = HTMLTag;
  HTMLTag.prototype.tagName = tagName;

  return HTMLTag;
};

// Not an HTMLjs node, but a wrapper to pass multiple attrs dictionaries
// to a tag (for the purpose of implementing dynamic attributes).
var Attrs = HTMLMine.Attrs = function (/*attrs dictionaries*/) {
  // Work with or without `new`.  If not called with `new`,
  // perform instantiation by recursively calling this constructor.
  // We can't pass varargs, so pass no args.
  var instance = (this instanceof Attrs) ? this : new Attrs;

  instance.value = SLICE.call(arguments);

  return instance;
};

////////////////////////////// KNOWN ELEMENTS

HTMLMine.getTag = function (tagName) {
  var symbolName = HTMLMine.getSymbolName(tagName);
  if (symbolName === tagName) // all-caps tagName
    throw new Error("Use the lowercase or camelCase form of '" + tagName + "' here");

  if (! HTMLMine[symbolName])
    HTMLMine[symbolName] = makeTagConstructor(tagName);

  return HTMLMine[symbolName];
};

HTMLMine.ensureTag = function (tagName) {
  HTMLMine.getTag(tagName); // don't return it
};

HTMLMine.isTagEnsured = function (tagName) {
  return HTMLMine.isKnownElement(tagName);
};

HTMLMine.getSymbolName = function (tagName) {
  // "foo-bar" -> "FOO_BAR"
  return tagName.toUpperCase().replace(/-/g, '_');
};

HTMLMine.knownElementNames = 'a abbr acronym address applet area article aside audio b base basefont bdi bdo big blockquote body br button canvas caption center cite code col colgroup command data datagrid datalist dd del details dfn dir div dl dt em embed eventsource fieldset figcaption figure font footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins isindex kbd keygen label legend li link main map mark menu meta meter nav noframes noscript object ol optgroup option output p param pre progress q rp rt ruby s samp script section select small source span strike strong style sub summary sup table tbody td textarea tfoot th thead time title tr track tt u ul var video wbr'.split(' ');
// (we add the SVG ones below)

HTMLMine.knownSVGElementNames = 'altGlyph altGlyphDef altGlyphItem animate animateColor animateMotion animateTransform circle clipPath color-profile cursor defs desc ellipse feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence filter font font-face font-face-format font-face-name font-face-src font-face-uri foreignObject g glyph glyphRef hkern image line linearGradient marker mask metadata missing-glyph path pattern polygon polyline radialGradient rect set stop style svg switch symbol text textPath title tref tspan use view vkern'.split(' ');
// Append SVG element names to list of known element names
HTMLMine.knownElementNames = HTMLMine.knownElementNames.concat(HTMLMine.knownSVGElementNames);

HTMLMine.voidElementNames = 'area base br col command embed hr img input keygen link meta param source track wbr'.split(' ');

// Speed up search through lists of known elements by creating internal "sets"
// of strings.
var YES = {yes:true};
var makeSet = function (array) {
  var set = {};
  for (var i = 0; i < array.length; i++)
    set[array[i]] = YES;
  return set;
};
var voidElementSet = makeSet(HTMLMine.voidElementNames);
var knownElementSet = makeSet(HTMLMine.knownElementNames);
var knownSVGElementSet = makeSet(HTMLMine.knownSVGElementNames);

HTMLMine.isKnownElement = function (tagName) {
  return knownElementSet[tagName] === YES;
};

HTMLMine.isKnownSVGElement = function (tagName) {
  return knownSVGElementSet[tagName] === YES;
};

HTMLMine.isVoidElement = function (tagName) {
  return voidElementSet[tagName] === YES;
};


// Ensure tags for all known elements
for (var i = 0; i < HTMLMine.knownElementNames.length; i++)
  HTMLMine.ensureTag(HTMLMine.knownElementNames[i]);


var CharRef = HTMLMine.CharRef = function (attrs) {
  if (! (this instanceof CharRef))
    // called without `new`
    return new CharRef(attrs);

  if (! (attrs && attrs.html && attrs.str))
    throw new Error(
      "HTMLMine.CharRef must be constructed with ({html:..., str:...})");

  this.html = attrs.html;
  this.str = attrs.str;
};
CharRef.prototype.htmljsType = CharRef.htmljsType = ['CharRef'];

var Comment = HTMLMine.Comment = function (value) {
  if (! (this instanceof Comment))
    // called without `new`
    return new Comment(value);

  if (typeof value !== 'string')
    throw new Error('HTMLMine.Comment must be constructed with a string');

  this.value = value;
  // Kill illegal hyphens in comment value (no way to escape them in HTML)
  this.sanitizedValue = value.replace(/^-|--+|-$/g, '');
};
Comment.prototype.htmljsType = Comment.htmljsType = ['Comment'];

var Raw = HTMLMine.Raw = function (value) {
  if (! (this instanceof Raw))
    // called without `new`
    return new Raw(value);

  if (typeof value !== 'string')
    throw new Error('HTMLMine.Raw must be constructed with a string');

  this.value = value;
};
Raw.prototype.htmljsType = Raw.htmljsType = ['Raw'];


HTMLMine.isArray = function (x) {
  // could change this to use the more convoluted Object.prototype.toString
  // approach that works when objects are passed between frames, but does
  // it matter?
  return (x instanceof Array);
};

HTMLMine.isConstructedObject = function (x) {
  // Figure out if `x` is "an instance of some class" or just a plain
  // object literal.  It correctly treats an object literal like
  // `{ constructor: ... }` as an object literal.  It won't detect
  // instances of classes that lack a `constructor` property (e.g.
  // if you assign to a prototype when setting up the class as in:
  // `Foo = function () { ... }; Foo.prototype = { ... }`, then
  // `(new Foo).constructor` is `Object`, not `Foo`).
  return (x && (typeof x === 'object') &&
          (x.constructor !== Object) &&
          (typeof x.constructor === 'function') &&
          (x instanceof x.constructor));
};

HTMLMine.isNully = function (node) {
  if (node == null)
    // null or undefined
    return true;

  if (HTMLMine.isArray(node)) {
    // is it an empty array or an array of all nully items?
    for (var i = 0; i < node.length; i++)
      if (! HTMLMine.isNully(node[i]))
        return false;
    return true;
  }

  return false;
};

HTMLMine.isValidAttributeName = function (name) {
  return /^[:_A-Za-z][:_A-Za-z0-9.\-]*/.test(name);
};

// If `attrs` is an array of attributes dictionaries, combines them
// into one.  Removes attributes that are "nully."
HTMLMine.flattenAttributes = function (attrs) {
  if (! attrs)
    return attrs;

  var isArray = HTMLMine.isArray(attrs);
  if (isArray && attrs.length === 0)
    return null;

  var result = {};
  for (var i = 0, N = (isArray ? attrs.length : 1); i < N; i++) {
    var oneAttrs = (isArray ? attrs[i] : attrs);
    if ((typeof oneAttrs !== 'object') ||
        HTMLMine.isConstructedObject(oneAttrs))
      throw new Error("Expected plain JS object as attrs, found: " + oneAttrs);
    for (var name in oneAttrs) {
      if (! HTMLMine.isValidAttributeName(name))
        throw new Error("Illegal HTML attribute name: " + name);
      var value = oneAttrs[name];
      if (! HTMLMine.isNully(value))
        result[name] = value;
    }
  }

  return result;
};



////////////////////////////// TOHTML

HTMLMine.toHTML = function (content) {
  return (new HTMLMine.ToHTMLVisitor).visit(content);
};

// Escaping modes for outputting text when generating HTMLMine.
HTMLMine.TEXTMODE = {
  STRING: 1,
  RCDATA: 2,
  ATTRIBUTE: 3
};


HTMLMine.toText = function (content, textMode) {
  if (! textMode)
    throw new Error("textMode required for HTMLMine.toText");
  if (! (textMode === HTMLMine.TEXTMODE.STRING ||
         textMode === HTMLMine.TEXTMODE.RCDATA ||
         textMode === HTMLMine.TEXTMODE.ATTRIBUTE))
    throw new Error("Unknown textMode: " + textMode);

  var visitor = new HTMLMine.ToTextVisitor({textMode: textMode});;
  return visitor.visit(content);
};


////////////////////////////// VISITORS

// _assign is like _.extend or the upcoming Object.assign.
// Copy src's own, enumerable properties onto tgt and return
// tgt.
var _hasOwnProperty = Object.prototype.hasOwnProperty;
var _assign = function (tgt, src) {
  for (var k in src) {
    if (_hasOwnProperty.call(src, k))
      tgt[k] = src[k];
  }
  return tgt;
};

HTMLMine.Visitor = function (props) {
  _assign(this, props);
};

HTMLMine.Visitor.def = function (options) {
  _assign(this.prototype, options);
};

HTMLMine.Visitor.extend = function (options) {
  var curType = this;
  var subType = function HTMLVisitorSubtype(/*arguments*/) {
    HTMLMine.Visitor.apply(this, arguments);
  };
  subType.prototype = new curType;
  subType.extend = curType.extend;
  subType.def = curType.def;
  if (options)
    _assign(subType.prototype, options);
  return subType;
};

HTMLMine.Visitor.def({
  visit: function (content/*, ...*/) {
    if (content == null)
      // null or undefined.
      return this.visitNull.apply(this, arguments);

    if (typeof content === 'object') {
      if (content.htmljsType) {
        switch (content.htmljsType) {
        case HTMLMine.Tag.htmljsType:
          return this.visitTag.apply(this, arguments);
        case HTMLMine.CharRef.htmljsType:
          return this.visitCharRef.apply(this, arguments);
        case HTMLMine.Comment.htmljsType:
          return this.visitComment.apply(this, arguments);
        case HTMLMine.Raw.htmljsType:
          return this.visitRaw.apply(this, arguments);
        default:
          throw new Error("Unknown htmljs type: " + content.htmljsType);
        }
      }

      if (HTMLMine.isArray(content))
        return this.visitArray.apply(this, arguments);

      return this.visitObject.apply(this, arguments);

    } else if ((typeof content === 'string') ||
               (typeof content === 'boolean') ||
               (typeof content === 'number')) {
      return this.visitPrimitive.apply(this, arguments);

    } else if (typeof content === 'function') {
      return this.visitFunction.apply(this, arguments);
    }

    throw new Error("Unexpected object in htmljs: " + content);

  },
  visitNull: function (nullOrUndefined/*, ...*/) {},
  visitPrimitive: function (stringBooleanOrNumber/*, ...*/) {},
  visitArray: function (array/*, ...*/) {},
  visitComment: function (comment/*, ...*/) {},
  visitCharRef: function (charRef/*, ...*/) {},
  visitRaw: function (raw/*, ...*/) {},
  visitTag: function (tag/*, ...*/) {},
  visitObject: function (obj/*, ...*/) {
    throw new Error("Unexpected object in htmljs: " + obj);
  },
  visitFunction: function (fn/*, ...*/) {
    throw new Error("Unexpected function in htmljs: " + fn);
  }
});

HTMLMine.TransformingVisitor = HTMLMine.Visitor.extend();
HTMLMine.TransformingVisitor.def({
  visitNull: IDENTITY,
  visitPrimitive: IDENTITY,
  visitArray: function (array/*, ...*/) {
    var argsCopy = SLICE.call(arguments);
    var result = array;
    for (var i = 0; i < array.length; i++) {
      var oldItem = array[i];
      argsCopy[0] = oldItem;
      var newItem = this.visit.apply(this, argsCopy);
      if (newItem !== oldItem) {
        // copy `array` on write
        if (result === array)
          result = array.slice();
        result[i] = newItem;
      }
    }
    return result;
  },
  visitComment: IDENTITY,
  visitCharRef: IDENTITY,
  visitRaw: IDENTITY,
  visitObject: IDENTITY,
  visitFunction: IDENTITY,
  visitTag: function (tag/*, ...*/) {
    var oldChildren = tag.children;
    var argsCopy = SLICE.call(arguments);
    argsCopy[0] = oldChildren;
    var newChildren = this.visitChildren.apply(this, argsCopy);

    var oldAttrs = tag.attrs;
    argsCopy[0] = oldAttrs;
    var newAttrs = this.visitAttributes.apply(this, argsCopy);

    if (newAttrs === oldAttrs && newChildren === oldChildren)
      return tag;

    var newTag = HTMLMine.getTag(tag.tagName).apply(null, newChildren);
    newTag.attrs = newAttrs;
    return newTag;
  },
  visitChildren: function (children/*, ...*/) {
    return this.visitArray.apply(this, arguments);
  },
  // Transform the `.attrs` property of a tag, which may be a dictionary,
  // an array, or in some uses, a foreign object (such as
  // a template tag).
  visitAttributes: function (attrs/*, ...*/) {
    if (HTMLMine.isArray(attrs)) {
      var argsCopy = SLICE.call(arguments);
      var result = attrs;
      for (var i = 0; i < attrs.length; i++) {
        var oldItem = attrs[i];
        argsCopy[0] = oldItem;
        var newItem = this.visitAttributes.apply(this, argsCopy);
        if (newItem !== oldItem) {
          // copy on write
          if (result === attrs)
            result = attrs.slice();
          result[i] = newItem;
        }
      }
      return result;
    }

    if (attrs && HTMLMine.isConstructedObject(attrs)) {
      throw new Error("The basic HTMLMine.TransformingVisitor does not support " +
                      "foreign objects in attributes.  Define a custom " +
                      "visitAttributes for this case.");
    }

    var oldAttrs = attrs;
    var newAttrs = oldAttrs;
    if (oldAttrs) {
      var attrArgs = [null, null];
      attrArgs.push.apply(attrArgs, arguments);
      for (var k in oldAttrs) {
        var oldValue = oldAttrs[k];
        attrArgs[0] = k;
        attrArgs[1] = oldValue;
        var newValue = this.visitAttribute.apply(this, attrArgs);
        if (newValue !== oldValue) {
          // copy on write
          if (newAttrs === oldAttrs)
            newAttrs = _assign({}, oldAttrs);
          newAttrs[k] = newValue;
        }
      }
    }

    return newAttrs;
  },
  // Transform the value of one attribute name/value in an
  // attributes dictionary.
  visitAttribute: function (name, value, tag/*, ...*/) {
    var args = SLICE.call(arguments, 2);
    args[0] = value;
    return this.visit.apply(this, args);
  }
});


HTMLMine.ToTextVisitor = HTMLMine.Visitor.extend();
HTMLMine.ToTextVisitor.def({
  visitNull: function (nullOrUndefined) {
    return '';
  },
  visitPrimitive: function (stringBooleanOrNumber) {
    var str = String(stringBooleanOrNumber);
    if (this.textMode === HTMLMine.TEXTMODE.RCDATA) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    } else if (this.textMode === HTMLMine.TEXTMODE.ATTRIBUTE) {
      // escape `&` and `"` this time, not `&` and `<`
      return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    } else {
      return str;
    }
  },
  visitArray: function (array) {
    var parts = [];
    for (var i = 0; i < array.length; i++)
      parts.push(this.visit(array[i]));
    return parts.join('');
  },
  visitComment: function (comment) {
    throw new Error("Can't have a comment here");
  },
  visitCharRef: function (charRef) {
    if (this.textMode === HTMLMine.TEXTMODE.RCDATA ||
        this.textMode === HTMLMine.TEXTMODE.ATTRIBUTE) {
      return charRef.html;
    } else {
      return charRef.str;
    }
  },
  visitRaw: function (raw) {
    return raw.value;
  },
  visitTag: function (tag) {
    // Really we should just disallow Tags here.  However, at the
    // moment it's useful to stringify any HTML we find.  In
    // particular, when you include a template within `{{#markdown}}`,
    // we render the template as text, and since there's currently
    // no way to make the template be *parsed* as text (e.g. `<template
    // type="text">`), we hackishly support HTML tags in markdown
    // in templates by parsing them and stringifying them.
    return this.visit(this.toHTML(tag));
  },
  visitObject: function (x) {
    throw new Error("Unexpected object in htmljs in toText: " + x);
  },
  toHTML: function (node) {
    return HTMLMine.toHTML(node);
  }
});



HTMLMine.ToHTMLVisitor = HTMLMine.Visitor.extend();
HTMLMine.ToHTMLVisitor.def({
  visitNull: function (nullOrUndefined) {
    return '';
  },
  visitPrimitive: function (stringBooleanOrNumber) {
    var str = String(stringBooleanOrNumber);
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  },
  visitArray: function (array) {
    var parts = [];
    for (var i = 0; i < array.length; i++)
      parts.push(this.visit(array[i]));
    return parts.join('');
  },
  visitComment: function (comment) {
    return '<!--' + comment.sanitizedValue + '-->';
  },
  visitCharRef: function (charRef) {
    return charRef.html;
  },
  visitRaw: function (raw) {
    return raw.value;
  },
  visitTag: function (tag) {
    var attrStrs = [];

    var tagName = tag.tagName;
    var children = tag.children;

    var attrs = tag.attrs;
    if (attrs) {
      attrs = HTMLMine.flattenAttributes(attrs);
      for (var k in attrs) {
        if (k === 'value' && tagName === 'textarea') {
          children = [attrs[k], children];
        } else {
          var v = this.toText(attrs[k], HTMLMine.TEXTMODE.ATTRIBUTE);
          attrStrs.push(' ' + k + '="' + v + '"');
        }
      }
    }

    var startTag = '<' + tagName + attrStrs.join('') + '>';

    var childStrs = [];
    var content;
    if (tagName === 'textarea') {

      for (var i = 0; i < children.length; i++)
        childStrs.push(this.toText(children[i], HTMLMine.TEXTMODE.RCDATA));

      content = childStrs.join('');
      if (content.slice(0, 1) === '\n')
        // TEXTAREA will absorb a newline, so if we see one, add
        // another one.
        content = '\n' + content;

    } else {
      for (var i = 0; i < children.length; i++)
        childStrs.push(this.visit(children[i]));

      content = childStrs.join('');
    }

    var result = startTag + content;

    if (children.length || ! HTMLMine.isVoidElement(tagName)) {
      // "Void" elements like BR are the only ones that don't get a close
      // tag in HTML5.  They shouldn't have contents, either, so we could
      // throw an error upon seeing contents here.
      result += '</' + tagName + '>';
    }

    return result;
  },
  visitObject: function (x) {
    throw new Error("Unexpected object in htmljs in toHTML: " + x);
  },
  toText: function (node, textMode) {
    return HTMLMine.toText(node, textMode);
  }
});
