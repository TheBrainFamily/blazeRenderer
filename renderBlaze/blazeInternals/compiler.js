import _ from 'underscore'
import './blazeWith'

SpacebarsCompilerMine = {}

  const getContent = function (scanner, shouldStopFunc) {
    var items = [];

    while (! scanner.isEOF()) {
      if (shouldStopFunc && shouldStopFunc(scanner))
        break;

      var posBefore = scanner.pos;
      var token = getHTMLToken(scanner);
      if (! token)
        // tokenizer reached EOF on its own, e.g. while scanning
        // template comments like `{{! foo}}`.
        continue;

      if (token.t === 'Doctype') {
        scanner.fatal("Unexpected Doctype");
      } else if (token.t === 'Chars') {
        pushOrAppendString(items, token.v);
      } else if (token.t === 'CharRef') {
        items.push(convertCharRef(token));
      } else if (token.t === 'Comment') {
        items.push(HTMLMine.Comment(token.v));
      } else if (token.t === 'TemplateTag') {
        items.push(token.v);
      } else if (token.t === 'Tag') {
        if (token.isEnd) {
          // Stop when we encounter an end tag at the top level.
          // Rewind; we'll re-parse the end tag later.
          scanner.pos = posBefore;
          break;
        }

        var tagName = token.n;
        // is this an element with no close tag (a BR, HR, IMG, etc.) based
        // on its name?
        var isVoid = HTMLMine.isVoidElement(tagName);
        if (token.isSelfClosing) {
          if (! (isVoid || HTMLMine.isKnownSVGElement(tagName) || tagName.indexOf(':') >= 0))
            scanner.fatal('Only certain elements like BR, HR, IMG, etc. (and foreign elements like SVG) are allowed to self-close');
        }

        // result of parseAttrs may be null
        var attrs = parseAttrs(token.attrs);
        // arrays need to be wrapped in HTMLMine.Attrs(...)
        // when used to construct tags
        if (HTMLMine.isArray(attrs))
          attrs = HTMLMine.Attrs.apply(null, attrs);

        var tagFunc = HTMLMine.getTag(tagName);
        if (isVoid || token.isSelfClosing) {
          items.push(attrs ? tagFunc(attrs) : tagFunc());
        } else {
          // parse HTML tag contents.

          // HTML treats a final `/` in a tag as part of an attribute, as in `<a href=/foo/>`, but the template author who writes `<circle r={{r}}/>`, say, may not be thinking about that, so generate a good error message in the "looks like self-close" case.
          var looksLikeSelfClose = (scanner.input.substr(scanner.pos - 2, 2) === '/>');

          var content = null;
          if (token.n === 'textarea') {
            if (scanner.peek() === '\n')
              scanner.pos++;
            var textareaValue = getRCData(scanner, token.n, shouldStopFunc);
            if (textareaValue) {
              if (attrs instanceof HTMLMine.Attrs) {
                attrs = HTMLMine.Attrs.apply(
                  null, attrs.value.concat([{value: textareaValue}]));
              } else {
                attrs = (attrs || {});
                attrs.value = textareaValue;
              }
            }
          } else if (token.n === 'script' || token.n === 'style') {
            content = getRawText(scanner, token.n, shouldStopFunc);
          } else {
            content = getContent(scanner, shouldStopFunc);
          }

          var endTag = getHTMLToken(scanner);

          if (! (endTag && endTag.t === 'Tag' && endTag.isEnd && endTag.n === tagName))
            scanner.fatal('Expected "' + tagName + '" end tag' + (looksLikeSelfClose ? ' -- if the "<' + token.n + ' />" tag was supposed to self-close, try adding a space before the "/"' : ''));

          // XXX support implied end tags in cases allowed by the spec

          // make `content` into an array suitable for applying tag constructor
          // as in `FOO.apply(null, content)`.
          if (content == null)
            content = [];
          else if (! (content instanceof Array))
            content = [content];

          items.push(HTMLMine.getTag(tagName).apply(
            null, (attrs ? [attrs] : []).concat(content)));
        }
      } else {
        scanner.fatal("Unknown token type: " + token.t);
      }
    }

    if (items.length === 0)
      return null;
    else if (items.length === 1)
      return items[0];
    else
      return items;
  };

  var pushOrAppendString = function (items, string) {
    if (items.length &&
        typeof items[items.length - 1] === 'string')
      items[items.length - 1] += string;
    else
      items.push(string);
  };

  // get RCDATA to go in the lowercase (or camel case) tagName (e.g. "textarea")
  getRCData = function (scanner, tagName, shouldStopFunc) {
    var items = [];

    while (! scanner.isEOF()) {
      // break at appropriate end tag
      if (tagName && isLookingAtEndTag(scanner, tagName))
        break;

      if (shouldStopFunc && shouldStopFunc(scanner))
        break;

      var token = getHTMLToken(scanner, 'rcdata');
      if (! token)
        // tokenizer reached EOF on its own, e.g. while scanning
        // template comments like `{{! foo}}`.
        continue;

      if (token.t === 'Chars') {
        pushOrAppendString(items, token.v);
      } else if (token.t === 'CharRef') {
        items.push(convertCharRef(token));
      } else if (token.t === 'TemplateTag') {
        items.push(token.v);
      } else {
        // (can't happen)
        scanner.fatal("Unknown or unexpected token type: " + token.t);
      }
    }

    if (items.length === 0)
      return null;
    else if (items.length === 1)
      return items[0];
    else
      return items;
  };

  var getRawText = function (scanner, tagName, shouldStopFunc) {
    var items = [];

    while (! scanner.isEOF()) {
      // break at appropriate end tag
      if (tagName && isLookingAtEndTag(scanner, tagName))
        break;

      if (shouldStopFunc && shouldStopFunc(scanner))
        break;

      var token = getHTMLToken(scanner, 'rawtext');
      if (! token)
        // tokenizer reached EOF on its own, e.g. while scanning
        // template comments like `{{! foo}}`.
        continue;

      if (token.t === 'Chars') {
        pushOrAppendString(items, token.v);
      } else if (token.t === 'TemplateTag') {
        items.push(token.v);
      } else {
        // (can't happen)
        scanner.fatal("Unknown or unexpected token type: " + token.t);
      }
    }

    if (items.length === 0)
      return null;
    else if (items.length === 1)
      return items[0];
    else
      return items;
  };

  // Input: A token like `{ t: 'CharRef', v: '&amp;', cp: [38] }`.
  //
  // Output: A tag like `HTMLMine.CharRef({ html: '&amp;', str: '&' })`.
  var convertCharRef = function (token) {
    var codePoints = token.cp;
    var str = '';
    for (var i = 0; i < codePoints.length; i++)
      str += codePointToString(codePoints[i]);
    return HTMLMine.CharRef({ html: token.v, str: str });
  };

  // Input is always a dictionary (even if zero attributes) and each
  // value in the dictionary is an array of `Chars`, `CharRef`,
  // and maybe `TemplateTag` tokens.
  //
  // Output is null if there are zero attributes, and otherwise a
  // dictionary, or an array of dictionaries and template tags.
  // Each value in the dictionary is HTMLjs (e.g. a
  // string or an array of `Chars`, `CharRef`, and `TemplateTag`
  // nodes).
  //
  // An attribute value with no input tokens is represented as "",
  // not an empty array, in order to prop open empty attributes
  // with no template tags.
  var parseAttrs = function (attrs) {
    var result = null;

    if (HTMLMine.isArray(attrs)) {
      // first element is nondynamic attrs, rest are template tags
      var nondynamicAttrs = parseAttrs(attrs[0]);
      if (nondynamicAttrs) {
        result = (result || []);
        result.push(nondynamicAttrs);
      }
      for (var i = 1; i < attrs.length; i++) {
        var token = attrs[i];
        if (token.t !== 'TemplateTag')
          throw new Error("Expected TemplateTag token");
        result = (result || []);
        result.push(token.v);
      }
      return result;
    }

    for (var k in attrs) {
      if (! result)
        result = {};

      var inValue = attrs[k];
      var outParts = [];
      for (var i = 0; i < inValue.length; i++) {
        var token = inValue[i];
        if (token.t === 'CharRef') {
          outParts.push(convertCharRef(token));
        } else if (token.t === 'TemplateTag') {
          outParts.push(token.v);
        } else if (token.t === 'Chars') {
          pushOrAppendString(outParts, token.v);
        }
      }

      var outValue = (inValue.length === 0 ? '' :
                      (outParts.length === 1 ? outParts[0] : outParts));
      var properKey = HTMLTools.properCaseAttributeName(k);
      result[properKey] = outValue;
    }

    return result;
  };




HTMLTools = {}

// This is a Scanner class suitable for any parser/lexer/tokenizer.
//
// A Scanner has an immutable source document (string) `input` and a current
// position `pos`, an index into the string, which can be set at will.
//
// * `new Scanner(input)` - constructs a Scanner with source string `input`
// * `scanner.rest()` - returns the rest of the input after `pos`
// * `scanner.peek()` - returns the character at `pos`
// * `scanner.isEOF()` - true if `pos` is at or beyond the end of `input`
// * `scanner.fatal(msg)` - throw an error indicating a problem at `pos`

Scanner = HTMLTools.Scanner = function (input) {
    this.input = input; // public, read-only
    this.pos = 0; // public, read-write
  };

  Scanner.prototype.rest = function () {
    // Slicing a string is O(1) in modern JavaScript VMs (including old IE).
    return this.input.slice(this.pos);
  };

  Scanner.prototype.isEOF = function () {
    return this.pos >= this.input.length;
  };

  Scanner.prototype.fatal = function (msg) {
    // despite this default, you should always provide a message!
    msg = (msg || "Parse error");

    var CONTEXT_AMOUNT = 20;

    var input = this.input;
    var pos = this.pos;
    var pastInput = input.substring(pos - CONTEXT_AMOUNT - 1, pos);
    if (pastInput.length > CONTEXT_AMOUNT)
      pastInput = '...' + pastInput.substring(-CONTEXT_AMOUNT);

    var upcomingInput = input.substring(pos, pos + CONTEXT_AMOUNT + 1);
    if (upcomingInput.length > CONTEXT_AMOUNT)
      upcomingInput = upcomingInput.substring(0, CONTEXT_AMOUNT) + '...';

    var positionDisplay = ((pastInput + upcomingInput).replace(/\n/g, ' ') + '\n' +
                           (new Array(pastInput.length + 1).join(' ')) + "^");

    var e = new Error(msg + "\n" + positionDisplay);

    e.offset = pos;
    var allPastInput = input.substring(0, pos);
    e.line = (1 + (allPastInput.match(/\n/g) || []).length);
    e.col = (1 + pos - allPastInput.lastIndexOf('\n'));
    e.scanner = this;

    throw e;
  };

  // Peek at the next character.
  //
  // If `isEOF`, returns an empty string.
  Scanner.prototype.peek = function () {
    return this.input.charAt(this.pos);
  };

  // Constructs a `getFoo` function where `foo` is specified with a regex.
  // The regex should start with `^`.  The constructed function will return
  // match group 1, if it exists and matches a non-empty string, or else
  // the entire matched string (or null if there is no match).
  //
  // A `getFoo` function tries to match and consume a foo.  If it succeeds,
  // the current position of the scanner is advanced.  If it fails, the
  // current position is not advanced and a falsy value (typically null)
  // is returned.
  makeRegexMatcher = function (regex) {
    return function (scanner) {
      var match = regex.exec(scanner.rest());

      if (! match)
        return null;

      scanner.pos += match[0].length;
      return match[1] || match[0];
    };
  };


  // templateTag.js html tools
// templateTag.js html tools
// templateTag.js html tools

// Parse a "fragment" of HTML, up to the end of the input or a particular
// template tag (using the "shouldStop" option).
HTMLTools.parseFragment = function (input, options) {
    var scanner;
    if (typeof input === 'string')
      scanner = new Scanner(input);
    else
      // input can be a scanner.  We'd better not have a different
      // value for the "getTemplateTag" option as when the scanner
      // was created, because we don't do anything special to reset
      // the value (which is attached to the scanner).
      scanner = input;

    // ```
    // { getTemplateTag: function (scanner, templateTagPosition) {
    //     if (templateTagPosition === HTMLTools.TEMPLATE_TAG_POSITION.ELEMENT) {
    //       ...
    // ```
    if (options && options.getTemplateTag)
      scanner.getTemplateTag = options.getTemplateTag;

    // function (scanner) -> boolean
    var shouldStop = options && options.shouldStop;

    var result;
    console.log("inside first if", options)

    if (options && options.textMode) {
      if (options.textMode === HTMLMine.TEXTMODE.STRING) {
        result = getRawText(scanner, null, shouldStop);
      } else if (options.textMode === HTMLMine.TEXTMODE.RCDATA) {
        result = getRCData(scanner, null, shouldStop);
      } else {
        throw new Error("Unsupported textMode: " + options.textMode);
      }
    } else {
      result = getContent(scanner, shouldStop);
    }
    if (! scanner.isEOF()) {
      // If we aren't at the end of the input, we either stopped at an unmatched
      // HTML end tag or at a template tag (like `{{else}}` or `{{/if}}`).
      // Detect the former case (stopped at an HTML end tag) and throw a good
      // error.

      var posBefore = scanner.pos;

      try {
        var endTag = getHTMLToken(scanner);
      } catch (e) {
        // ignore errors from getTemplateTag
      }

      // XXX we make some assumptions about shouldStop here, like that it
      // won't tell us to stop at an HTML end tag.  Should refactor
      // `shouldStop` into something more suitable.
      if (endTag && endTag.t === 'Tag' && endTag.isEnd) {
        var closeTag = endTag.n;
        var isVoidElement = HTMLMine.isVoidElement(closeTag);
        scanner.fatal("Unexpected HTML close tag" +
                      (isVoidElement ?
                       '.  <' + endTag.n + '> should have no close tag.' : ''));
      }

      scanner.pos = posBefore; // rewind, we'll continue parsing as usual

      // If no "shouldStop" option was provided, we should have consumed the whole
      // input.
      if (! shouldStop)
        scanner.fatal("Expected EOF");
    }

    return result;
  };




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


HTMLTools.TemplateTag = function (props) {
  if (! (this instanceof HTMLTools.TemplateTag))
    // called without `new`
    return new HTMLTools.TemplateTag;

  if (props)
    _assign(this, props);
};

_assign(HTMLTools.TemplateTag.prototype, {
  constructorName: 'HTMLTools.TemplateTag',
  toJS: function (visitor) {
    return visitor.generateCall(this.constructorName,
                                _assign({}, this));
  }
});


// templatetag.js

SpacebarsCompiler = {};

// A TemplateTag is the result of parsing a single `{{...}}` tag.
//
// The `.type` of a TemplateTag is one of:
//
// - `"DOUBLE"` - `{{foo}}`
// - `"TRIPLE"` - `{{{foo}}}`
// - `"EXPR"` - `(foo)`
// - `"COMMENT"` - `{{! foo}}`
// - `"BLOCKCOMMENT" - `{{!-- foo--}}`
// - `"INCLUSION"` - `{{> foo}}`
// - `"BLOCKOPEN"` - `{{#foo}}`
// - `"BLOCKCLOSE"` - `{{/foo}}`
// - `"ELSE"` - `{{else}}`
// - `"ESCAPE"` - `{{|`, `{{{|`, `{{{{|` and so on
//
// Besides `type`, the mandatory properties of a TemplateTag are:
//
// - `path` - An array of one or more strings.  The path of `{{foo.bar}}`
//   is `["foo", "bar"]`.  Applies to DOUBLE, TRIPLE, INCLUSION, BLOCKOPEN,
//   BLOCKCLOSE, and ELSE.
//
// - `args` - An array of zero or more argument specs.  An argument spec
//   is a two or three element array, consisting of a type, value, and
//   optional keyword name.  For example, the `args` of `{{foo "bar" x=3}}`
//   are `[["STRING", "bar"], ["NUMBER", 3, "x"]]`.  Applies to DOUBLE,
//   TRIPLE, INCLUSION, BLOCKOPEN, and ELSE.
//
// - `value` - A string of the comment's text. Applies to COMMENT and
//   BLOCKCOMMENT.
//
// These additional are typically set during parsing:
//
// - `position` - The HTMLTools.TEMPLATE_TAG_POSITION specifying at what sort
//   of site the TemplateTag was encountered (e.g. at element level or as
//   part of an attribute value). Its absence implies
//   TEMPLATE_TAG_POSITION.ELEMENT.
//
// - `content` and `elseContent` - When a BLOCKOPEN tag's contents are
//   parsed, they are put here.  `elseContent` will only be present if
//   an `{{else}}` was found.

var TEMPLATE_TAG_POSITION = HTMLTools.TEMPLATE_TAG_POSITION;

TemplateTag = SpacebarsCompilerMine.TemplateTag = function () {
  HTMLTools.TemplateTag.apply(this, arguments);
};
TemplateTag.prototype = new HTMLTools.TemplateTag;
TemplateTag.prototype.constructorName = 'SpacebarsCompilerMine.TemplateTag';

var makeStacheTagStartRegex = function (r) {
  return new RegExp(r.source + /(?![{>!#/])/.source,
                    r.ignoreCase ? 'i' : '');
};

// "starts" regexes are used to see what type of template
// tag the parser is looking at.  They must match a non-empty
// result, but not the interesting part of the tag.
var starts = {
  ESCAPE: /^\{\{(?=\{*\|)/,
  ELSE: makeStacheTagStartRegex(/^\{\{\s*else(\s+(?!\s)|(?=[}]))/i),
  DOUBLE: makeStacheTagStartRegex(/^\{\{\s*(?!\s)/),
  TRIPLE: makeStacheTagStartRegex(/^\{\{\{\s*(?!\s)/),
  BLOCKCOMMENT: makeStacheTagStartRegex(/^\{\{\s*!--/),
  COMMENT: makeStacheTagStartRegex(/^\{\{\s*!/),
  INCLUSION: makeStacheTagStartRegex(/^\{\{\s*>\s*(?!\s)/),
  BLOCKOPEN: makeStacheTagStartRegex(/^\{\{\s*#\s*(?!\s)/),
  BLOCKCLOSE: makeStacheTagStartRegex(/^\{\{\s*\/\s*(?!\s)/)
};

var ends = {
  DOUBLE: /^\s*\}\}/,
  TRIPLE: /^\s*\}\}\}/,
  EXPR: /^\s*\)/
};

var endsString = {
  DOUBLE: '}}',
  TRIPLE: '}}}',
  EXPR: ')'
};

// Parse a tag from the provided scanner or string.  If the input
// doesn't start with `{{`, returns null.  Otherwise, either succeeds
// and returns a SpacebarsCompilerMine.TemplateTag, or throws an error (using
// `scanner.fatal` if a scanner is provided).
TemplateTag.parse = function (scannerOrString) {
  var scanner = scannerOrString;
  if (typeof scanner === 'string')
    scanner = new HTMLTools.Scanner(scannerOrString);

  if (! (scanner.peek() === '{' &&
         (scanner.rest()).slice(0, 2) === '{{'))
    return null;

  var run = function (regex) {
    // regex is assumed to start with `^`
    var result = regex.exec(scanner.rest());
    if (! result)
      return null;
    var ret = result[0];
    scanner.pos += ret.length;
    return ret;
  };

  var advance = function (amount) {
    scanner.pos += amount;
  };

  var scanIdentifier = function (isFirstInPath) {
    var id = BlazeTools.parseExtendedIdentifierName(scanner);
    if (! id) {
      expected('IDENTIFIER');
    }
    if (isFirstInPath &&
        (id === 'null' || id === 'true' || id === 'false'))
      scanner.fatal("Can't use null, true, or false, as an identifier at start of path");

    return id;
  };

  var scanPath = function () {
    var segments = [];

    // handle initial `.`, `..`, `./`, `../`, `../..`, `../../`, etc
    var dots;
    if ((dots = run(/^[\.\/]+/))) {
      var ancestorStr = '.'; // eg `../../..` maps to `....`
      var endsWithSlash = /\/$/.test(dots);

      if (endsWithSlash)
        dots = dots.slice(0, -1);

      _.each(dots.split('/'), function(dotClause, index) {
        if (index === 0) {
          if (dotClause !== '.' && dotClause !== '..')
            expected("`.`, `..`, `./` or `../`");
        } else {
          if (dotClause !== '..')
            expected("`..` or `../`");
        }

        if (dotClause === '..')
          ancestorStr += '.';
      });

      segments.push(ancestorStr);

      if (!endsWithSlash)
        return segments;
    }

    while (true) {
      // scan a path segment

      if (run(/^\[/)) {
        var seg = run(/^[\s\S]*?\]/);
        if (! seg)
          error("Unterminated path segment");
        seg = seg.slice(0, -1);
        if (! seg && ! segments.length)
          error("Path can't start with empty string");
        segments.push(seg);
      } else {
        var id = scanIdentifier(! segments.length);
        if (id === 'this') {
          if (! segments.length) {
            // initial `this`
            segments.push('.');
          } else {
            error("Can only use `this` at the beginning of a path.\nInstead of `foo.this` or `../this`, just write `foo` or `..`.");
          }
        } else {
          segments.push(id);
        }
      }

      var sep = run(/^[\.\/]/);
      if (! sep)
        break;
    }

    return segments;
  };

  // scan the keyword portion of a keyword argument
  // (the "foo" portion in "foo=bar").
  // Result is either the keyword matched, or null
  // if we're not at a keyword argument position.
  var scanArgKeyword = function () {
    var match = /^([^\{\}\(\)\>#=\s"'\[\]]+)\s*=\s*/.exec(scanner.rest());
    if (match) {
      scanner.pos += match[0].length;
      return match[1];
    } else {
      return null;
    }
  };

  // scan an argument; succeeds or errors.
  // Result is an array of two or three items:
  // type , value, and (indicating a keyword argument)
  // keyword name.
  var scanArg = function () {
    var keyword = scanArgKeyword(); // null if not parsing a kwarg
    var value = scanArgValue();
    return keyword ? value.concat(keyword) : value;
  };

  // scan an argument value (for keyword or positional arguments);
  // succeeds or errors.  Result is an array of type, value.
  var scanArgValue = function () {
    var startPos = scanner.pos;
    var result;
    if ((result = BlazeTools.parseNumber(scanner))) {
      return ['NUMBER', result.value];
    } else if ((result = BlazeTools.parseStringLiteral(scanner))) {
      return ['STRING', result.value];
    } else if (/^[\.\[]/.test(scanner.peek())) {
      return ['PATH', scanPath()];
    } else if (run(/^\(/)) {
      return ['EXPR', scanExpr('EXPR')];
    } else if ((result = BlazeTools.parseExtendedIdentifierName(scanner))) {
      var id = result;
      if (id === 'null') {
        return ['NULL', null];
      } else if (id === 'true' || id === 'false') {
        return ['BOOLEAN', id === 'true'];
      } else {
        scanner.pos = startPos; // unconsume `id`
        return ['PATH', scanPath()];
      }
    } else {
      expected('identifier, number, string, boolean, null, or a sub expression enclosed in "(", ")"');
    }
  };

  var scanExpr = function (type) {
    var endType = type;
    if (type === 'INCLUSION' || type === 'BLOCKOPEN' || type === 'ELSE')
      endType = 'DOUBLE';

    var tag = new TemplateTag;
    tag.type = type;
    tag.path = scanPath();
    tag.args = [];
    var foundKwArg = false;
    while (true) {
      run(/^\s*/);
      if (run(ends[endType]))
        break;
      else if (/^[})]/.test(scanner.peek())) {
        expected('`' + endsString[endType] + '`');
      }
      var newArg = scanArg();
      if (newArg.length === 3) {
        foundKwArg = true;
      } else {
        if (foundKwArg)
          error("Can't have a non-keyword argument after a keyword argument");
      }
      tag.args.push(newArg);

      // expect a whitespace or a closing ')' or '}'
      if (run(/^(?=[\s})])/) !== '')
        expected('space');
    }

    return tag;
  };

  var type;

  var error = function (msg) {
    scanner.fatal(msg);
  };

  var expected = function (what) {
    error('Expected ' + what);
  };

  // must do ESCAPE first, immediately followed by ELSE
  // order of others doesn't matter
  if (run(starts.ESCAPE)) type = 'ESCAPE';
  else if (run(starts.ELSE)) type = 'ELSE';
  else if (run(starts.DOUBLE)) type = 'DOUBLE';
  else if (run(starts.TRIPLE)) type = 'TRIPLE';
  else if (run(starts.BLOCKCOMMENT)) type = 'BLOCKCOMMENT';
  else if (run(starts.COMMENT)) type = 'COMMENT';
  else if (run(starts.INCLUSION)) type = 'INCLUSION';
  else if (run(starts.BLOCKOPEN)) type = 'BLOCKOPEN';
  else if (run(starts.BLOCKCLOSE)) type = 'BLOCKCLOSE';
  else
    error('Unknown stache tag');

  var tag = new TemplateTag;
  tag.type = type;

  if (type === 'BLOCKCOMMENT') {
    var result = run(/^[\s\S]*?--\s*?\}\}/);
    if (! result)
      error("Unclosed block comment");
    tag.value = result.slice(0, result.lastIndexOf('--'));
  } else if (type === 'COMMENT') {
    var result = run(/^[\s\S]*?\}\}/);
    if (! result)
      error("Unclosed comment");
    tag.value = result.slice(0, -2);
  } else if (type === 'BLOCKCLOSE') {
    tag.path = scanPath();
    if (! run(ends.DOUBLE))
      expected('`}}`');
  } else if (type === 'ELSE') {
    if (! run(ends.DOUBLE)) {
      tag = scanExpr(type);
    }
  } else if (type === 'ESCAPE') {
    var result = run(/^\{*\|/);
    tag.value = '{{' + result.slice(0, -1);
  } else {
    // DOUBLE, TRIPLE, BLOCKOPEN, INCLUSION
    tag = scanExpr(type);
  }

  return tag;
};

// Returns a SpacebarsCompilerMine.TemplateTag parsed from `scanner`, leaving scanner
// at its original position.
//
// An error will still be thrown if there is not a valid template tag at
// the current position.
TemplateTag.peek = function (scanner) {
  var startPos = scanner.pos;
  var result = TemplateTag.parse(scanner);
  scanner.pos = startPos;
  return result;
};

// Like `TemplateTag.parse`, but in the case of blocks, parse the complete
// `{{#foo}}...{{/foo}}` with `content` and possible `elseContent`, rather
// than just the BLOCKOPEN tag.
//
// In addition:
//
// - Throws an error if `{{else}}` or `{{/foo}}` tag is encountered.
//
// - Returns `null` for a COMMENT.  (This case is distinguishable from
//   parsing no tag by the fact that the scanner is advanced.)
//
// - Takes an HTMLTools.TEMPLATE_TAG_POSITION `position` and sets it as the
//   TemplateTag's `.position` property.
//
// - Validates the tag's well-formedness and legality at in its position.
TemplateTag.parseCompleteTag = function (scannerOrString, position) {
  var scanner = scannerOrString;
  if (typeof scanner === 'string')
    scanner = new HTMLTools.Scanner(scannerOrString);

  var startPos = scanner.pos; // for error messages
  var result = TemplateTag.parse(scannerOrString);
  if (! result)
    return result;

  if (result.type === 'BLOCKCOMMENT')
    return null;

  if (result.type === 'COMMENT')
    return null;

  if (result.type === 'ELSE')
    scanner.fatal("Unexpected {{else}}");

  if (result.type === 'BLOCKCLOSE')
    scanner.fatal("Unexpected closing template tag");

  position = (position || TEMPLATE_TAG_POSITION.ELEMENT);
  if (position !== TEMPLATE_TAG_POSITION.ELEMENT)
    result.position = position;

  if (result.type === 'BLOCKOPEN') {
    // parse block contents

    // Construct a string version of `.path` for comparing start and
    // end tags.  For example, `foo/[0]` was parsed into `["foo", "0"]`
    // and now becomes `foo,0`.  This form may also show up in error
    // messages.
    var blockName = result.path.join(',');

    var textMode = null;
      if (blockName === 'markdown' ||
          position === TEMPLATE_TAG_POSITION.IN_RAWTEXT) {
        textMode = HTMLMine.TEXTMODE.STRING;
      } else if (position === TEMPLATE_TAG_POSITION.IN_RCDATA ||
                 position === TEMPLATE_TAG_POSITION.IN_ATTRIBUTE) {
        textMode = HTMLMine.TEXTMODE.RCDATA;
      }
      var parserOptions = {
        getTemplateTag: TemplateTag.parseCompleteTag,
        shouldStop: isAtBlockCloseOrElse,
        textMode: textMode
      };
    result.content = HTMLTools.parseFragment(scanner, parserOptions);

    if (scanner.rest().slice(0, 2) !== '{{')
      scanner.fatal("Expected {{else}} or block close for " + blockName);

    var lastPos = scanner.pos; // save for error messages
    var tmplTag = TemplateTag.parse(scanner); // {{else}} or {{/foo}}

    var lastElseContentTag = result;
    while (tmplTag.type === 'ELSE') {
      if (lastElseContentTag === null) {
        scanner.fatal("Unexpected else after {{else}}");
      }

      if (tmplTag.path) {
        lastElseContentTag.elseContent = new TemplateTag;
        lastElseContentTag.elseContent.type = 'BLOCKOPEN';
        lastElseContentTag.elseContent.path = tmplTag.path;
        lastElseContentTag.elseContent.args = tmplTag.args;
        lastElseContentTag.elseContent.content = HTMLTools.parseFragment(scanner, parserOptions);

        lastElseContentTag = lastElseContentTag.elseContent;
      }
      else {
        // parse {{else}} and content up to close tag
        lastElseContentTag.elseContent = HTMLTools.parseFragment(scanner, parserOptions);

        lastElseContentTag = null;
      }

      if (scanner.rest().slice(0, 2) !== '{{')
        scanner.fatal("Expected block close for " + blockName);

      lastPos = scanner.pos;
      tmplTag = TemplateTag.parse(scanner);
    }

    if (tmplTag.type === 'BLOCKCLOSE') {
      var blockName2 = tmplTag.path.join(',');
      if (blockName !== blockName2) {
        scanner.pos = lastPos;
        scanner.fatal('Expected tag to close ' + blockName + ', found ' +
                      blockName2);
      }
    } else {
      scanner.pos = lastPos;
      scanner.fatal('Expected tag to close ' + blockName + ', found ' +
                    tmplTag.type);
    }
  }

  var finalPos = scanner.pos;
  scanner.pos = startPos;
  validateTag(result, scanner);
  scanner.pos = finalPos;

  return result;
};

var isAtBlockCloseOrElse = function (scanner) {
  // Detect `{{else}}` or `{{/foo}}`.
  //
  // We do as much work ourselves before deferring to `TemplateTag.peek`,
  // for efficiency (we're called for every input token) and to be
  // less obtrusive, because `TemplateTag.peek` will throw an error if it
  // sees `{{` followed by a malformed tag.
  var rest, type;
  return (scanner.peek() === '{' &&
          (rest = scanner.rest()).slice(0, 2) === '{{' &&
          /^\{\{\s*(\/|else\b)/.test(rest) &&
          (type = TemplateTag.peek(scanner).type) &&
          (type === 'BLOCKCLOSE' || type === 'ELSE'));
};

// Validate that `templateTag` is correctly formed and legal for its
// HTML position.  Use `scanner` to report errors. On success, does
// nothing.
var validateTag = function (ttag, scanner) {

  if (ttag.type === 'INCLUSION' || ttag.type === 'BLOCKOPEN') {
    var args = ttag.args;
    if (ttag.path[0] === 'each' && args[1] && args[1][0] === 'PATH' &&
        args[1][1][0] === 'in') {
      // For slightly better error messages, we detect the each-in case
      // here in order not to complain if the user writes `{{#each 3 in x}}`
      // that "3 is not a function"
    } else {
      if (args.length > 1 && args[0].length === 2 && args[0][0] !== 'PATH') {
        // we have a positional argument that is not a PATH followed by
        // other arguments
        scanner.fatal("First argument must be a function, to be called on " +
                      "the rest of the arguments; found " + args[0][0]);
      }
    }
  }

  var position = ttag.position || TEMPLATE_TAG_POSITION.ELEMENT;
  if (position === TEMPLATE_TAG_POSITION.IN_ATTRIBUTE) {
    if (ttag.type === 'DOUBLE' || ttag.type === 'ESCAPE') {
      return;
    } else if (ttag.type === 'BLOCKOPEN') {
      var path = ttag.path;
      var path0 = path[0];
      if (! (path.length === 1 && (path0 === 'if' ||
                                   path0 === 'unless' ||
                                   path0 === 'with' ||
                                   path0 === 'each'))) {
        scanner.fatal("Custom block helpers are not allowed in an HTML attribute, only built-in ones like #each and #if");
      }
    } else {
      scanner.fatal(ttag.type + " template tag is not allowed in an HTML attribute");
    }
  } else if (position === TEMPLATE_TAG_POSITION.IN_START_TAG) {
    if (! (ttag.type === 'DOUBLE')) {
      scanner.fatal("Reactive HTML attributes must either have a constant name or consist of a single {{helper}} providing a dictionary of names and values.  A template tag of type " + ttag.type + " is not allowed here.");
    }
    if (scanner.peek() === '=') {
      scanner.fatal("Template tags are not allowed in attribute names, only in attribute values or in the form of a single {{helper}} that evaluates to a dictionary of name=value pairs.");
    }
  }

};


SpacebarsCompilerMine.parse = function (input) {

  var tree = HTMLTools.parseFragment(
    input,
    { getTemplateTag: TemplateTag.parseCompleteTag });

  return tree;
};

export default function (input, options) {
  var tree = SpacebarsCompilerMine.parse(input);
  return SpacebarsCompilerMine.codeGen(tree, options);
};

// export default compileMine

SpacebarsCompilerMine._TemplateTagReplacer = HTMLMine.TransformingVisitor.extend();
SpacebarsCompilerMine._TemplateTagReplacer.def({
  visitObject: function (x) {
    if (x instanceof HTMLTools.TemplateTag) {

      // Make sure all TemplateTags in attributes have the right
      // `.position` set on them.  This is a bit of a hack
      // (we shouldn't be mutating that here), but it allows
      // cleaner codegen of "synthetic" attributes like TEXTAREA's
      // "value", where the template tags were originally not
      // in an attribute.
      if (this.inAttributeValue)
        x.position = HTMLTools.TEMPLATE_TAG_POSITION.IN_ATTRIBUTE;

      return this.codegen.codeGenTemplateTag(x);
    }

    return HTMLMine.TransformingVisitor.prototype.visitObject.call(this, x);
  },
  visitAttributes: function (attrs) {
    if (attrs instanceof HTMLTools.TemplateTag)
      return this.codegen.codeGenTemplateTag(attrs);

    // call super (e.g. for case where `attrs` is an array)
    return HTMLMine.TransformingVisitor.prototype.visitAttributes.call(this, attrs);
  },
  visitAttribute: function (name, value, tag) {
    this.inAttributeValue = true;
    var result = this.visit(value);
    this.inAttributeValue = false;

    if (result !== value) {
      // some template tags must have been replaced, because otherwise
      // we try to keep things `===` when transforming.  Wrap the code
      // in a function as per the rules.  You can't have
      // `{id: BlazeMine.View(...)}` as an attributes dict because the View
      // would be rendered more than once; you need to wrap it in a function
      // so that it's a different View each time.
      return BlazeTools.EmitCode(this.codegen.codeGenBlock(result));
    }
    return result;
  }
});


// Optimize parts of an HTMLjs tree into raw HTML strings when they don't
// contain template tags.

var constant = function (value) {
    return function () { return value; };
  };

  var OPTIMIZABLE = {
    NONE: 0,
    PARTS: 1,
    FULL: 2
  };

  // We can only turn content into an HTML string if it contains no template
  // tags and no "tricky" HTML tags.  If we can optimize the entire content
  // into a string, we return OPTIMIZABLE.FULL.  If the we are given an
  // unoptimizable node, we return OPTIMIZABLE.NONE.  If we are given a tree
  // that contains an unoptimizable node somewhere, we return OPTIMIZABLE.PARTS.
  //
  // For example, we always create SVG elements programmatically, since SVG
  // doesn't have innerHTMLMine.  If we are given an SVG element, we return NONE.
  // However, if we are given a big tree that contains SVG somewhere, we
  // return PARTS so that the optimizer can descend into the tree and optimize
  // other parts of it.
  var CanOptimizeVisitor = HTMLMine.Visitor.extend();
  CanOptimizeVisitor.def({
    visitNull: constant(OPTIMIZABLE.FULL),
    visitPrimitive: constant(OPTIMIZABLE.FULL),
    visitComment: constant(OPTIMIZABLE.FULL),
    visitCharRef: constant(OPTIMIZABLE.FULL),
    visitRaw: constant(OPTIMIZABLE.FULL),
    visitObject: constant(OPTIMIZABLE.NONE),
    visitFunction: constant(OPTIMIZABLE.NONE),
    visitArray: function (x) {
      for (var i = 0; i < x.length; i++)
        if (this.visit(x[i]) !== OPTIMIZABLE.FULL)
          return OPTIMIZABLE.PARTS;
      return OPTIMIZABLE.FULL;
    },
    visitTag: function (tag) {
      var tagName = tag.tagName;
      if (tagName === 'textarea') {
        // optimizing into a TEXTAREA's RCDATA would require being a little
        // more clever.
        return OPTIMIZABLE.NONE;
      } else if (tagName === 'script') {
        // script tags don't work when rendered from strings
        return OPTIMIZABLE.NONE;
      } else if (! (HTMLMine.isKnownElement(tagName) &&
                    ! HTMLMine.isKnownSVGElement(tagName))) {
        // foreign elements like SVG can't be stringified for innerHTMLMine.
        return OPTIMIZABLE.NONE;
      } else if (tagName === 'table') {
        // Avoid ever producing HTML containing `<table><tr>...`, because the
        // browser will insert a TBODY.  If we just `createElement("table")` and
        // `createElement("tr")`, on the other hand, no TBODY is necessary
        // (assuming IE 8+).
        return OPTIMIZABLE.NONE;
      }

      var children = tag.children;
      for (var i = 0; i < children.length; i++)
        if (this.visit(children[i]) !== OPTIMIZABLE.FULL)
          return OPTIMIZABLE.PARTS;

      if (this.visitAttributes(tag.attrs) !== OPTIMIZABLE.FULL)
        return OPTIMIZABLE.PARTS;

      return OPTIMIZABLE.FULL;
    },
    visitAttributes: function (attrs) {
      if (attrs) {
        var isArray = HTMLMine.isArray(attrs);
        for (var i = 0; i < (isArray ? attrs.length : 1); i++) {
          var a = (isArray ? attrs[i] : attrs);
          if ((typeof a !== 'object') || (a instanceof HTMLTools.TemplateTag))
            return OPTIMIZABLE.PARTS;
          for (var k in a)
            if (this.visit(a[k]) !== OPTIMIZABLE.FULL)
              return OPTIMIZABLE.PARTS;
        }
      }
      return OPTIMIZABLE.FULL;
    }
  });

  var getOptimizability = function (content) {
    return (new CanOptimizeVisitor).visit(content);
  };

  var toRaw = function (x) {
    return HTMLMine.Raw(HTMLMine.toHTML(x));
  };

  var TreeTransformer = HTMLMine.TransformingVisitor.extend();
  TreeTransformer.def({
    visitAttributes: function (attrs/*, ...*/) {
      // pass template tags through by default
      if (attrs instanceof HTMLTools.TemplateTag)
        return attrs;

      return HTMLMine.TransformingVisitor.prototype.visitAttributes.apply(
        this, arguments);
    }
  });

  // Replace parts of the HTMLjs tree that have no template tags (or
  // tricky HTML tags) with HTMLMine.Raw objects containing raw HTMLMine.
  var OptimizingVisitor = TreeTransformer.extend();
  OptimizingVisitor.def({
    visitNull: toRaw,
    visitPrimitive: toRaw,
    visitComment: toRaw,
    visitCharRef: toRaw,
    visitArray: function (array) {
      var optimizability = getOptimizability(array);
      if (optimizability === OPTIMIZABLE.FULL) {
        return toRaw(array);
      } else if (optimizability === OPTIMIZABLE.PARTS) {
        return TreeTransformer.prototype.visitArray.call(this, array);
      } else {
        return array;
      }
    },
    visitTag: function (tag) {
      var optimizability = getOptimizability(tag);
      if (optimizability === OPTIMIZABLE.FULL) {
        return toRaw(tag);
      } else if (optimizability === OPTIMIZABLE.PARTS) {
        return TreeTransformer.prototype.visitTag.call(this, tag);
      } else {
        return tag;
      }
    },
    visitChildren: function (children) {
      // don't optimize the children array into a Raw object!
      return TreeTransformer.prototype.visitArray.call(this, children);
    },
    visitAttributes: function (attrs) {
      return attrs;
    }
  });

  // Combine consecutive HTMLMine.Raws.  Remove empty ones.
  var RawCompactingVisitor = TreeTransformer.extend();
  RawCompactingVisitor.def({
    visitArray: function (array) {
      var result = [];
      for (var i = 0; i < array.length; i++) {
        var item = array[i];
        if ((item instanceof HTMLMine.Raw) &&
            ((! item.value) ||
             (result.length &&
              (result[result.length - 1] instanceof HTMLMine.Raw)))) {
          // two cases: item is an empty Raw, or previous item is
          // a Raw as well.  In the latter case, replace the previous
          // Raw with a longer one that includes the new Raw.
          if (item.value) {
            result[result.length - 1] = HTMLMine.Raw(
              result[result.length - 1].value + item.value);
          }
        } else {
          result.push(item);
        }
      }
      return result;
    }
  });

  // Replace pointless Raws like `HTMLMine.Raw('foo')` that contain no special
  // characters with simple strings.
  var RawReplacingVisitor = TreeTransformer.extend();
  RawReplacingVisitor.def({
    visitRaw: function (raw) {
      var html = raw.value;
      if (html.indexOf('&') < 0 && html.indexOf('<') < 0) {
        return html;
      } else {
        return raw;
      }
    }
  });

  SpacebarsCompilerMine.optimize = function (tree) {
    tree = (new OptimizingVisitor).visit(tree);
    tree = (new RawCompactingVisitor).visit(tree);
    tree = (new RawReplacingVisitor).visit(tree);
    return tree;
  };

SpacebarsCompilerMine.codeGen = function (parseTree, options) {
  // is this a template, rather than a block passed to
  // a block helper, say
  var isTemplate = (options && options.isTemplate);
  var isBody = (options && options.isBody);
  var sourceName = (options && options.sourceName);

  var tree = parseTree;

  // The flags `isTemplate` and `isBody` are kind of a hack.
  if (isTemplate || isBody) {
    // optimizing fragments would require being smarter about whether we are
    // in a TEXTAREA, say.
    tree = SpacebarsCompilerMine.optimize(tree);
  }

  // throws an error if using `{{> React}}` with siblings

  var codegen = new SpacebarsCompilerMine.CodeGen;
  tree = (new SpacebarsCompilerMine._TemplateTagReplacer(
    {codegen: codegen})).visit(tree);

  var code = '(function () { ';
  if (isTemplate || isBody) {
    code += 'var view = this; ';
  }
  code += 'return ';
  code += BlazeTools.toJS(tree);
  code += '; })';

  code = SpacebarsCompilerMine._beautify(code);

  return code;
};

SpacebarsCompilerMine._beautify = function (code) {
  return code;
};


// Parse a "fragment" of HTML, up to the end of the input or a particular
// template tag (using the "shouldStop" option).
HTMLTools.parseFragment = function (input, options) {
    var scanner;
    if (typeof input === 'string')
      scanner = new Scanner(input);
    else
      // input can be a scanner.  We'd better not have a different
      // value for the "getTemplateTag" option as when the scanner
      // was created, because we don't do anything special to reset
      // the value (which is attached to the scanner).
      scanner = input;

    // ```
    // { getTemplateTag: function (scanner, templateTagPosition) {
    //     if (templateTagPosition === HTMLTools.TEMPLATE_TAG_POSITION.ELEMENT) {
    //       ...
    // ```
    if (options && options.getTemplateTag)
      scanner.getTemplateTag = options.getTemplateTag;

    // function (scanner) -> boolean
    var shouldStop = options && options.shouldStop;

    var result;
    if (options && options.textMode) {
      if (options.textMode === HTMLMine.TEXTMODE.STRING) {
        result = getRawText(scanner, null, shouldStop);
      } else if (options.textMode === HTMLMine.TEXTMODE.RCDATA) {
        result = getRCData(scanner, null, shouldStop);
      } else {
        throw new Error("Unsupported textMode: " + options.textMode);
      }
    } else {
      result = getContent(scanner, shouldStop);
    }
    if (! scanner.isEOF()) {
      // If we aren't at the end of the input, we either stopped at an unmatched
      // HTML end tag or at a template tag (like `{{else}}` or `{{/if}}`).
      // Detect the former case (stopped at an HTML end tag) and throw a good
      // error.

      var posBefore = scanner.pos;

      try {
        var endTag = getHTMLToken(scanner);
      } catch (e) {
        // ignore errors from getTemplateTag
      }

      // XXX we make some assumptions about shouldStop here, like that it
      // won't tell us to stop at an HTML end tag.  Should refactor
      // `shouldStop` into something more suitable.
      if (endTag && endTag.t === 'Tag' && endTag.isEnd) {
        var closeTag = endTag.n;
        var isVoidElement = HTMLMine.isVoidElement(closeTag);
        scanner.fatal("Unexpected HTML close tag" +
                      (isVoidElement ?
                       '.  <' + endTag.n + '> should have no close tag.' : ''));
      }

      scanner.pos = posBefore; // rewind, we'll continue parsing as usual

      // If no "shouldStop" option was provided, we should have consumed the whole
      // input.
      if (! shouldStop)
        scanner.fatal("Expected EOF");
    }

    return result;
  };

  // Take a numeric Unicode code point, which may be larger than 16 bits,
  // and encode it as a JavaScript UTF-16 string.
  //
  // Adapted from
  // http://stackoverflow.com/questions/7126384/expressing-utf-16-unicode-characters-in-javascript/7126661.
  codePointToString = HTMLTools.codePointToString = function(cp) {
    if (cp >= 0 && cp <= 0xD7FF || cp >= 0xE000 && cp <= 0xFFFF) {
      return String.fromCharCode(cp);
    } else if (cp >= 0x10000 && cp <= 0x10FFFF) {

      // we substract 0x10000 from cp to get a 20-bit number
      // in the range 0..0xFFFF
      cp -= 0x10000;

      // we add 0xD800 to the number formed by the first 10 bits
      // to give the first byte
      var first = ((0xffc00 & cp) >> 10) + 0xD800;

      // we add 0xDC00 to the number formed by the low 10 bits
      // to give the second byte
      var second = (0x3ff & cp) + 0xDC00;

      return String.fromCharCode(first) + String.fromCharCode(second);
    } else {
      return '';
    }
  };







  // Token types:
//
// { t: 'Doctype',
//   v: String (entire Doctype declaration from the source),
//   name: String,
//   systemId: String (optional),
//   publicId: String (optional)
// }
//
// { t: 'Comment',
//   v: String (not including "<!--" and "-->")
// }
//
// { t: 'Chars',
//   v: String (pure text like you might pass to document.createTextNode,
//              no character references)
// }
//
// { t: 'Tag',
//   isEnd: Boolean (optional),
//   isSelfClosing: Boolean (optional),
//   n: String (tag name, in lowercase or camel case),
//   attrs: dictionary of { String: [tokens] }
//          OR [{ String: [tokens] }, TemplateTag tokens...]
//     (only for start tags; required)
// }
//
// { t: 'CharRef',
//   v: String (entire character reference from the source, e.g. "&amp;"),
//   cp: [Integer] (array of Unicode code point numbers it expands to)
// }
//
// We keep around both the original form of the character reference and its
// expansion so that subsequent processing steps have the option to
// re-emit it (if they are generating HTML) or interpret it.  Named and
// numerical code points may be more than 16 bits, in which case they
// need to passed through codePointToString to make a JavaScript string.
// Most named entities and all numeric character references are one codepoint
// (e.g. "&amp;" is [38]), but a few are two codepoints.
//
// { t: 'TemplateTag',
//   v: HTMLTools.TemplateTag
// }

// The HTML tokenization spec says to preprocess the input stream to replace
// CR(LF)? with LF.  However, preprocessing `scanner` would complicate things
// by making indexes not match the input (e.g. for error messages), so we just
// keep in mind as we go along that an LF might be represented by CRLF or CR.
// In most cases, it doesn't actually matter what combination of whitespace
// characters are present (e.g. inside tags).
var HTML_SPACE = /^[\f\n\r\t ]/;

var convertCRLF = function (str) {
  return str.replace(/\r\n?/g, '\n');
};

getComment = function (scanner) {
  if (scanner.rest().slice(0, 4) !== '<!--')
    return null;
  scanner.pos += 4;

  // Valid comments are easy to parse; they end at the first `--`!
  // Our main job is throwing errors.

  var rest = scanner.rest();
  if (rest.charAt(0) === '>' || rest.slice(0, 2) === '->')
    scanner.fatal("HTML comment can't start with > or ->");

  var closePos = rest.indexOf('-->');
  if (closePos < 0)
    scanner.fatal("Unclosed HTML comment");

  var commentContents = rest.slice(0, closePos);
  if (commentContents.slice(-1) === '-')
    scanner.fatal("HTML comment must end at first `--`");
  if (commentContents.indexOf("--") >= 0)
    scanner.fatal("HTML comment cannot contain `--` anywhere");
  if (commentContents.indexOf('\u0000') >= 0)
    scanner.fatal("HTML comment cannot contain NULL");

  scanner.pos += closePos + 3;

  return { t: 'Comment',
           v: convertCRLF(commentContents) };
};

var skipSpaces = function (scanner) {
  while (HTML_SPACE.test(scanner.peek()))
    scanner.pos++;
};

var requireSpaces = function (scanner) {
  // if (! HTML_SPACE.test(scanner.peek()))
  //   scanner.fatal("Expected space");
  skipSpaces(scanner);
};

var getDoctypeQuotedString = function (scanner) {
  var quote = scanner.peek();
  if (! (quote === '"' || quote === "'"))
    scanner.fatal("Expected single or double quote in DOCTYPE");
  scanner.pos++;

  if (scanner.peek() === quote)
    // prevent a falsy return value (empty string)
    scanner.fatal("Malformed DOCTYPE");

  var str = '';
  var ch;
  while ((ch = scanner.peek()), ch !== quote) {
    if ((! ch) || (ch === '\u0000') || (ch === '>'))
      scanner.fatal("Malformed DOCTYPE");
    str += ch;
    scanner.pos++;
  }

  scanner.pos++;

  return str;
};

// See http://www.whatwg.org/specs/web-apps/current-work/multipage/syntax.html#the-doctype.
//
// If `getDocType` sees "<!DOCTYPE" (case-insensitive), it will match or fail fatally.
getDoctype = function (scanner) {
  if (HTMLTools.asciiLowerCase(scanner.rest().slice(0, 9)) !== '<!doctype')
    return null;
  var start = scanner.pos;
  scanner.pos += 9;

  requireSpaces(scanner);

  var ch = scanner.peek();
  if ((! ch) || (ch === '>') || (ch === '\u0000'))
    scanner.fatal('Malformed DOCTYPE');
  var name = ch;
  scanner.pos++;

  while ((ch = scanner.peek()), ! (HTML_SPACE.test(ch) || ch === '>')) {
    if ((! ch) || (ch === '\u0000'))
      scanner.fatal('Malformed DOCTYPE');
    name += ch;
    scanner.pos++;
  }
  name = HTMLTools.asciiLowerCase(name);

  // Now we're looking at a space or a `>`.
  skipSpaces(scanner);

  var systemId = null;
  var publicId = null;

  if (scanner.peek() !== '>') {
    // Now we're essentially in the "After DOCTYPE name state" of the tokenizer,
    // but we're not looking at space or `>`.

    // this should be "public" or "system".
    var publicOrSystem = HTMLTools.asciiLowerCase(scanner.rest().slice(0, 6));

    if (publicOrSystem === 'system') {
      scanner.pos += 6;
      requireSpaces(scanner);
      systemId = getDoctypeQuotedString(scanner);
      skipSpaces(scanner);
      if (scanner.peek() !== '>')
        scanner.fatal("Malformed DOCTYPE");
    } else if (publicOrSystem === 'public') {
      scanner.pos += 6;
      requireSpaces(scanner);
      publicId = getDoctypeQuotedString(scanner);
      if (scanner.peek() !== '>') {
        requireSpaces(scanner);
        if (scanner.peek() !== '>') {
          systemId = getDoctypeQuotedString(scanner);
          skipSpaces(scanner);
          if (scanner.peek() !== '>')
            scanner.fatal("Malformed DOCTYPE");
        }
      }
    } else {
      scanner.fatal("Expected PUBLIC or SYSTEM in DOCTYPE");
    }
  }

  // looking at `>`
  scanner.pos++;
  var result = { t: 'Doctype',
                 v: scanner.input.slice(start, scanner.pos),
                 name: name };

  if (systemId)
    result.systemId = systemId;
  if (publicId)
    result.publicId = publicId;

  return result;
};

// The special character `{` is only allowed as the first character
// of a Chars, so that we have a chance to detect template tags.
var getChars = makeRegexMatcher(/^[^&<\u0000][^&<\u0000{]*/);

var assertIsTemplateTag = function (x) {
  if (! (x instanceof HTMLTools.TemplateTag))
    throw new Error("Expected an instance of HTMLTools.TemplateTag");
  return x;
};

HTMLTools.Parse = {}


var asciiLowerCase = HTMLTools.asciiLowerCase = function (str) {
    return str.replace(/[A-Z]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) + 32);
    });
  };

  var svgCamelCaseAttributes = 'attributeName attributeType baseFrequency baseProfile calcMode clipPathUnits contentScriptType contentStyleType diffuseConstant edgeMode externalResourcesRequired filterRes filterUnits glyphRef glyphRef gradientTransform gradientTransform gradientUnits gradientUnits kernelMatrix kernelUnitLength kernelUnitLength kernelUnitLength keyPoints keySplines keyTimes lengthAdjust limitingConeAngle markerHeight markerUnits markerWidth maskContentUnits maskUnits numOctaves pathLength patternContentUnits patternTransform patternUnits pointsAtX pointsAtY pointsAtZ preserveAlpha preserveAspectRatio primitiveUnits refX refY repeatCount repeatDur requiredExtensions requiredFeatures specularConstant specularExponent specularExponent spreadMethod spreadMethod startOffset stdDeviation stitchTiles surfaceScale surfaceScale systemLanguage tableValues targetX targetY textLength textLength viewBox viewTarget xChannelSelector yChannelSelector zoomAndPan'.split(' ');

  var properAttributeCaseMap = (function (map) {
    for (var i = 0; i < svgCamelCaseAttributes.length; i++) {
      var a = svgCamelCaseAttributes[i];
      map[asciiLowerCase(a)] = a;
    }
    return map;
  })({});

  var properTagCaseMap = (function (map) {
    var knownElements = HTMLMine.knownElementNames;
    for (var i = 0; i < knownElements.length; i++) {
      var a = knownElements[i];
      map[asciiLowerCase(a)] = a;
    }
    return map;
  })({});

  // Take a tag name in any case and make it the proper case for HTMLMine.
  //
  // Modern browsers let you embed SVG in HTML, but SVG elements are special
  // in that they have a case-sensitive DOM API (nodeName, getAttribute,
  // setAttribute).  For example, it has to be `setAttribute("viewBox")`,
  // not `"viewbox"`.  However, the browser's HTML parser is NOT case sensitive
  // and will fix the case for you, so if you write `<svg viewbox="...">`
  // you actually get a `"viewBox"` attribute.  Any HTML-parsing toolchain
  // must do the same.
  HTMLTools.properCaseTagName = function (name) {
    var lowered = asciiLowerCase(name);
    return properTagCaseMap.hasOwnProperty(lowered) ?
      properTagCaseMap[lowered] : lowered;
  };

  // See docs for properCaseTagName.
  HTMLTools.properCaseAttributeName = function (name) {
    var lowered = asciiLowerCase(name);
    return properAttributeCaseMap.hasOwnProperty(lowered) ?
      properAttributeCaseMap[lowered] : lowered;
  };


// Returns the next HTML token, or `null` if we reach EOF.
//
// Note that if we have a `getTemplateTag` function that sometimes
// consumes characters and emits nothing (e.g. in the case of template
// comments), we may go from not-at-EOF to at-EOF and return `null`,
// while otherwise we always find some token to return.
getHTMLToken = HTMLTools.Parse.getHTMLToken = function (scanner, dataMode) {
  var result = null;
  if (scanner.getTemplateTag) {
    // Try to parse a template tag by calling out to the provided
    // `getTemplateTag` function.  If the function returns `null` but
    // consumes characters, it must have parsed a comment or something,
    // so we loop and try it again.  If it ever returns `null` without
    // consuming anything, that means it didn't see anything interesting
    // so we look for a normal token.  If it returns a truthy value,
    // the value must be instanceof HTMLTools.TemplateTag.  We wrap it
    // in a Special token.
    var lastPos = scanner.pos;
    result = scanner.getTemplateTag(
      scanner,
      (dataMode === 'rcdata' ? TEMPLATE_TAG_POSITION.IN_RCDATA :
       (dataMode === 'rawtext' ? TEMPLATE_TAG_POSITION.IN_RAWTEXT :
        TEMPLATE_TAG_POSITION.ELEMENT)));

    if (result)
      return { t: 'TemplateTag', v: assertIsTemplateTag(result) };
    else if (scanner.pos > lastPos)
      return null;
  }

  var chars = getChars(scanner);
  if (chars)
    return { t: 'Chars',
             v: convertCRLF(chars) };

  var ch = scanner.peek();
  if (! ch)
    return null; // EOF

  if (ch === '\u0000')
    scanner.fatal("Illegal NULL character");

  if (ch === '&') {
    if (dataMode !== 'rawtext') {
      var charRef = getCharacterReference(scanner);
      if (charRef)
        return charRef;
    }

    scanner.pos++;
    return { t: 'Chars',
             v: '&' };
  }

  // If we're here, we're looking at `<`.

  if (scanner.peek() === '<' && dataMode) {
    // don't interpret tags
    scanner.pos++;
    return { t: 'Chars',
             v: '<' };
  }

  // `getTag` will claim anything starting with `<` not followed by `!`.
  // `getComment` takes `<!--` and getDoctype takes `<!doctype`.
  result = (getTagToken(scanner) || getComment(scanner) || getDoctype(scanner));

  if (result)
    return result;

  scanner.fatal("Unexpected `<!` directive.");
};

var getTagName = makeRegexMatcher(/^[a-zA-Z][^\f\n\r\t />{]*/);
var getClangle = makeRegexMatcher(/^>/);
var getSlash = makeRegexMatcher(/^\//);
var getAttributeName = makeRegexMatcher(/^[^>/\u0000"'<=\f\n\r\t ][^\f\n\r\t /=>"'<\u0000]*/);

// Try to parse `>` or `/>`, mutating `tag` to be self-closing in the latter
// case (and failing fatally if `/` isn't followed by `>`).
// Return tag if successful.
var handleEndOfTag = function (scanner, tag) {
  if (getClangle(scanner))
    return tag;

  if (getSlash(scanner)) {
    if (! getClangle(scanner))
      scanner.fatal("Expected `>` after `/`");
    tag.isSelfClosing = true;
    return tag;
  }

  return null;
};

// Scan a quoted or unquoted attribute value (omit `quote` for unquoted).
var getAttributeValue = function (scanner, quote) {
  if (quote) {
    if (scanner.peek() !== quote)
      return null;
    scanner.pos++;
  }

  var tokens = [];
  var charsTokenToExtend = null;

  var charRef;
  while (true) {
    var ch = scanner.peek();
    var templateTag;
    var curPos = scanner.pos;
    if (quote && ch === quote) {
      scanner.pos++;
      return tokens;
    } else if ((! quote) && (HTML_SPACE.test(ch) || ch === '>')) {
      return tokens;
    } else if (! ch) {
      scanner.fatal("Unclosed attribute in tag");
    } else if (quote ? ch === '\u0000' : ('\u0000"\'<=`'.indexOf(ch) >= 0)) {
      scanner.fatal("Unexpected character in attribute value");
    } else if (ch === '&' &&
               (charRef = getCharacterReference(scanner, true,
                                                quote || '>'))) {
      tokens.push(charRef);
      charsTokenToExtend = null;
    } else if (scanner.getTemplateTag &&
               ((templateTag = scanner.getTemplateTag(
                 scanner, TEMPLATE_TAG_POSITION.IN_ATTRIBUTE)) ||
                scanner.pos > curPos /* `{{! comment}}` */)) {
      if (templateTag) {
        tokens.push({t: 'TemplateTag',
                     v: assertIsTemplateTag(templateTag)});
        charsTokenToExtend = null;
      }
    } else {
      if (! charsTokenToExtend) {
        charsTokenToExtend = { t: 'Chars', v: '' };
        tokens.push(charsTokenToExtend);
      }
      charsTokenToExtend.v += (ch === '\r' ? '\n' : ch);
      scanner.pos++;
      if (quote && ch === '\r' && scanner.peek() === '\n')
        scanner.pos++;
    }
  }
};

var hasOwnProperty = Object.prototype.hasOwnProperty;

getTagToken = HTMLTools.Parse.getTagToken = function (scanner) {
  if (! (scanner.peek() === '<' && scanner.rest().charAt(1) !== '!'))
    return null;
  scanner.pos++;

  var tag = { t: 'Tag' };

  // now looking at the character after `<`, which is not a `!`
  if (scanner.peek() === '/') {
    tag.isEnd = true;
    scanner.pos++;
  }

  var tagName = getTagName(scanner);
  if (! tagName)
    scanner.fatal("Expected tag name after `<`");
  tag.n = HTMLTools.properCaseTagName(tagName);

  if (scanner.peek() === '/' && tag.isEnd)
    scanner.fatal("End tag can't have trailing slash");
  if (handleEndOfTag(scanner, tag))
    return tag;

  if (scanner.isEOF())
    scanner.fatal("Unclosed `<`");

  if (! HTML_SPACE.test(scanner.peek()))
    // e.g. `<a{{b}}>`
    scanner.fatal("Expected space after tag name");

  // we're now in "Before attribute name state" of the tokenizer
  skipSpaces(scanner);

  if (scanner.peek() === '/' && tag.isEnd)
    scanner.fatal("End tag can't have trailing slash");
  if (handleEndOfTag(scanner, tag))
    return tag;

  if (tag.isEnd)
    scanner.fatal("End tag can't have attributes");

  tag.attrs = {};
  var nondynamicAttrs = tag.attrs;

  while (true) {
    // Note: at the top of this loop, we've already skipped any spaces.

    // This will be set to true if after parsing the attribute, we should
    // require spaces (or else an end of tag, i.e. `>` or `/>`).
    var spacesRequiredAfter = false;

    // first, try for a template tag.
    var curPos = scanner.pos;
    var templateTag = (scanner.getTemplateTag &&
                       scanner.getTemplateTag(
                         scanner, TEMPLATE_TAG_POSITION.IN_START_TAG));
    if (templateTag || (scanner.pos > curPos)) {
      if (templateTag) {
        if (tag.attrs === nondynamicAttrs)
          tag.attrs = [nondynamicAttrs];
        tag.attrs.push({ t: 'TemplateTag',
                         v: assertIsTemplateTag(templateTag) });
      } // else, must have scanned a `{{! comment}}`

      spacesRequiredAfter = true;
    } else {

      var attributeName = getAttributeName(scanner);
      if (! attributeName)
        scanner.fatal("Expected attribute name in tag");
      // Throw error on `{` in attribute name.  This provides *some* error message
      // if someone writes `<a x{{y}}>` or `<a x{{y}}=z>`.  The HTML tokenization
      // spec doesn't say that `{` is invalid, but the DOM API (setAttribute) won't
      // allow it, so who cares.
      if (attributeName.indexOf('{') >= 0)
        scanner.fatal("Unexpected `{` in attribute name.");
      attributeName = HTMLTools.properCaseAttributeName(attributeName);

      if (hasOwnProperty.call(nondynamicAttrs, attributeName))
        scanner.fatal("Duplicate attribute in tag: " + attributeName);

      nondynamicAttrs[attributeName] = [];

      skipSpaces(scanner);

      if (handleEndOfTag(scanner, tag))
        return tag;

      var ch = scanner.peek();
      if (! ch)
        scanner.fatal("Unclosed <");
      if ('\u0000"\'<'.indexOf(ch) >= 0)
        scanner.fatal("Unexpected character after attribute name in tag");

      if (ch === '=') {
        scanner.pos++;

        skipSpaces(scanner);

        ch = scanner.peek();
        if (! ch)
          scanner.fatal("Unclosed <");
        if ('\u0000><=`'.indexOf(ch) >= 0)
          scanner.fatal("Unexpected character after = in tag");

        if ((ch === '"') || (ch === "'"))
          nondynamicAttrs[attributeName] = getAttributeValue(scanner, ch);
        else
          nondynamicAttrs[attributeName] = getAttributeValue(scanner);

        spacesRequiredAfter = true;
      }
    }
    // now we are in the "post-attribute" position, whether it was a template tag
    // attribute (like `{{x}}`) or a normal one (like `x` or `x=y`).

    if (handleEndOfTag(scanner, tag))
      return tag;

    if (scanner.isEOF())
      scanner.fatal("Unclosed `<`");

    if (spacesRequiredAfter)
      requireSpaces(scanner);
    else
      skipSpaces(scanner);

    if (handleEndOfTag(scanner, tag))
      return tag;
  }
};

TEMPLATE_TAG_POSITION = HTMLTools.TEMPLATE_TAG_POSITION = {
  ELEMENT: 1,
  IN_START_TAG: 2,
  IN_ATTRIBUTE: 3,
  IN_RCDATA: 4,
  IN_RAWTEXT: 5
};

// tagName must be proper case
isLookingAtEndTag = function (scanner, tagName) {
  var rest = scanner.rest();
  var pos = 0; // into rest
  var firstPart = /^<\/([a-zA-Z]+)/.exec(rest);
  if (firstPart &&
      HTMLTools.properCaseTagName(firstPart[1]) === tagName) {
    // we've seen `</foo`, now see if the end tag continues
    pos += firstPart[0].length;
    while (pos < rest.length && HTML_SPACE.test(rest.charAt(pos)))
      pos++;
    if (pos < rest.length && rest.charAt(pos) === '>')
      return true;
  }
  return false;
};



BlazeTools = {}

// Adapted from source code of http://xregexp.com/plugins/#unicode
var unicodeCategories = {
    Ll: "0061-007A00B500DF-00F600F8-00FF01010103010501070109010B010D010F01110113011501170119011B011D011F01210123012501270129012B012D012F01310133013501370138013A013C013E014001420144014601480149014B014D014F01510153015501570159015B015D015F01610163016501670169016B016D016F0171017301750177017A017C017E-0180018301850188018C018D019201950199-019B019E01A101A301A501A801AA01AB01AD01B001B401B601B901BA01BD-01BF01C601C901CC01CE01D001D201D401D601D801DA01DC01DD01DF01E101E301E501E701E901EB01ED01EF01F001F301F501F901FB01FD01FF02010203020502070209020B020D020F02110213021502170219021B021D021F02210223022502270229022B022D022F02310233-0239023C023F0240024202470249024B024D024F-02930295-02AF037103730377037B-037D039003AC-03CE03D003D103D5-03D703D903DB03DD03DF03E103E303E503E703E903EB03ED03EF-03F303F503F803FB03FC0430-045F04610463046504670469046B046D046F04710473047504770479047B047D047F0481048B048D048F04910493049504970499049B049D049F04A104A304A504A704A904AB04AD04AF04B104B304B504B704B904BB04BD04BF04C204C404C604C804CA04CC04CE04CF04D104D304D504D704D904DB04DD04DF04E104E304E504E704E904EB04ED04EF04F104F304F504F704F904FB04FD04FF05010503050505070509050B050D050F05110513051505170519051B051D051F05210523052505270561-05871D00-1D2B1D6B-1D771D79-1D9A1E011E031E051E071E091E0B1E0D1E0F1E111E131E151E171E191E1B1E1D1E1F1E211E231E251E271E291E2B1E2D1E2F1E311E331E351E371E391E3B1E3D1E3F1E411E431E451E471E491E4B1E4D1E4F1E511E531E551E571E591E5B1E5D1E5F1E611E631E651E671E691E6B1E6D1E6F1E711E731E751E771E791E7B1E7D1E7F1E811E831E851E871E891E8B1E8D1E8F1E911E931E95-1E9D1E9F1EA11EA31EA51EA71EA91EAB1EAD1EAF1EB11EB31EB51EB71EB91EBB1EBD1EBF1EC11EC31EC51EC71EC91ECB1ECD1ECF1ED11ED31ED51ED71ED91EDB1EDD1EDF1EE11EE31EE51EE71EE91EEB1EED1EEF1EF11EF31EF51EF71EF91EFB1EFD1EFF-1F071F10-1F151F20-1F271F30-1F371F40-1F451F50-1F571F60-1F671F70-1F7D1F80-1F871F90-1F971FA0-1FA71FB0-1FB41FB61FB71FBE1FC2-1FC41FC61FC71FD0-1FD31FD61FD71FE0-1FE71FF2-1FF41FF61FF7210A210E210F2113212F21342139213C213D2146-2149214E21842C30-2C5E2C612C652C662C682C6A2C6C2C712C732C742C76-2C7B2C812C832C852C872C892C8B2C8D2C8F2C912C932C952C972C992C9B2C9D2C9F2CA12CA32CA52CA72CA92CAB2CAD2CAF2CB12CB32CB52CB72CB92CBB2CBD2CBF2CC12CC32CC52CC72CC92CCB2CCD2CCF2CD12CD32CD52CD72CD92CDB2CDD2CDF2CE12CE32CE42CEC2CEE2CF32D00-2D252D272D2DA641A643A645A647A649A64BA64DA64FA651A653A655A657A659A65BA65DA65FA661A663A665A667A669A66BA66DA681A683A685A687A689A68BA68DA68FA691A693A695A697A723A725A727A729A72BA72DA72F-A731A733A735A737A739A73BA73DA73FA741A743A745A747A749A74BA74DA74FA751A753A755A757A759A75BA75DA75FA761A763A765A767A769A76BA76DA76FA771-A778A77AA77CA77FA781A783A785A787A78CA78EA791A793A7A1A7A3A7A5A7A7A7A9A7FAFB00-FB06FB13-FB17FF41-FF5A",
    Lm: "02B0-02C102C6-02D102E0-02E402EC02EE0374037A0559064006E506E607F407F507FA081A0824082809710E460EC610FC17D718431AA71C78-1C7D1D2C-1D6A1D781D9B-1DBF2071207F2090-209C2C7C2C7D2D6F2E2F30053031-3035303B309D309E30FC-30FEA015A4F8-A4FDA60CA67FA717-A71FA770A788A7F8A7F9A9CFAA70AADDAAF3AAF4FF70FF9EFF9F",
    Lo: "00AA00BA01BB01C0-01C3029405D0-05EA05F0-05F20620-063F0641-064A066E066F0671-06D306D506EE06EF06FA-06FC06FF07100712-072F074D-07A507B107CA-07EA0800-08150840-085808A008A2-08AC0904-0939093D09500958-09610972-09770979-097F0985-098C098F09900993-09A809AA-09B009B209B6-09B909BD09CE09DC09DD09DF-09E109F009F10A05-0A0A0A0F0A100A13-0A280A2A-0A300A320A330A350A360A380A390A59-0A5C0A5E0A72-0A740A85-0A8D0A8F-0A910A93-0AA80AAA-0AB00AB20AB30AB5-0AB90ABD0AD00AE00AE10B05-0B0C0B0F0B100B13-0B280B2A-0B300B320B330B35-0B390B3D0B5C0B5D0B5F-0B610B710B830B85-0B8A0B8E-0B900B92-0B950B990B9A0B9C0B9E0B9F0BA30BA40BA8-0BAA0BAE-0BB90BD00C05-0C0C0C0E-0C100C12-0C280C2A-0C330C35-0C390C3D0C580C590C600C610C85-0C8C0C8E-0C900C92-0CA80CAA-0CB30CB5-0CB90CBD0CDE0CE00CE10CF10CF20D05-0D0C0D0E-0D100D12-0D3A0D3D0D4E0D600D610D7A-0D7F0D85-0D960D9A-0DB10DB3-0DBB0DBD0DC0-0DC60E01-0E300E320E330E40-0E450E810E820E840E870E880E8A0E8D0E94-0E970E99-0E9F0EA1-0EA30EA50EA70EAA0EAB0EAD-0EB00EB20EB30EBD0EC0-0EC40EDC-0EDF0F000F40-0F470F49-0F6C0F88-0F8C1000-102A103F1050-1055105A-105D106110651066106E-10701075-1081108E10D0-10FA10FD-1248124A-124D1250-12561258125A-125D1260-1288128A-128D1290-12B012B2-12B512B8-12BE12C012C2-12C512C8-12D612D8-13101312-13151318-135A1380-138F13A0-13F41401-166C166F-167F1681-169A16A0-16EA1700-170C170E-17111720-17311740-17511760-176C176E-17701780-17B317DC1820-18421844-18771880-18A818AA18B0-18F51900-191C1950-196D1970-19741980-19AB19C1-19C71A00-1A161A20-1A541B05-1B331B45-1B4B1B83-1BA01BAE1BAF1BBA-1BE51C00-1C231C4D-1C4F1C5A-1C771CE9-1CEC1CEE-1CF11CF51CF62135-21382D30-2D672D80-2D962DA0-2DA62DA8-2DAE2DB0-2DB62DB8-2DBE2DC0-2DC62DC8-2DCE2DD0-2DD62DD8-2DDE3006303C3041-3096309F30A1-30FA30FF3105-312D3131-318E31A0-31BA31F0-31FF3400-4DB54E00-9FCCA000-A014A016-A48CA4D0-A4F7A500-A60BA610-A61FA62AA62BA66EA6A0-A6E5A7FB-A801A803-A805A807-A80AA80C-A822A840-A873A882-A8B3A8F2-A8F7A8FBA90A-A925A930-A946A960-A97CA984-A9B2AA00-AA28AA40-AA42AA44-AA4BAA60-AA6FAA71-AA76AA7AAA80-AAAFAAB1AAB5AAB6AAB9-AABDAAC0AAC2AADBAADCAAE0-AAEAAAF2AB01-AB06AB09-AB0EAB11-AB16AB20-AB26AB28-AB2EABC0-ABE2AC00-D7A3D7B0-D7C6D7CB-D7FBF900-FA6DFA70-FAD9FB1DFB1F-FB28FB2A-FB36FB38-FB3CFB3EFB40FB41FB43FB44FB46-FBB1FBD3-FD3DFD50-FD8FFD92-FDC7FDF0-FDFBFE70-FE74FE76-FEFCFF66-FF6FFF71-FF9DFFA0-FFBEFFC2-FFC7FFCA-FFCFFFD2-FFD7FFDA-FFDC",
    Lt: "01C501C801CB01F21F88-1F8F1F98-1F9F1FA8-1FAF1FBC1FCC1FFC",
    Lu: "0041-005A00C0-00D600D8-00DE01000102010401060108010A010C010E01100112011401160118011A011C011E01200122012401260128012A012C012E01300132013401360139013B013D013F0141014301450147014A014C014E01500152015401560158015A015C015E01600162016401660168016A016C016E017001720174017601780179017B017D018101820184018601870189-018B018E-0191019301940196-0198019C019D019F01A001A201A401A601A701A901AC01AE01AF01B1-01B301B501B701B801BC01C401C701CA01CD01CF01D101D301D501D701D901DB01DE01E001E201E401E601E801EA01EC01EE01F101F401F6-01F801FA01FC01FE02000202020402060208020A020C020E02100212021402160218021A021C021E02200222022402260228022A022C022E02300232023A023B023D023E02410243-02460248024A024C024E03700372037603860388-038A038C038E038F0391-03A103A3-03AB03CF03D2-03D403D803DA03DC03DE03E003E203E403E603E803EA03EC03EE03F403F703F903FA03FD-042F04600462046404660468046A046C046E04700472047404760478047A047C047E0480048A048C048E04900492049404960498049A049C049E04A004A204A404A604A804AA04AC04AE04B004B204B404B604B804BA04BC04BE04C004C104C304C504C704C904CB04CD04D004D204D404D604D804DA04DC04DE04E004E204E404E604E804EA04EC04EE04F004F204F404F604F804FA04FC04FE05000502050405060508050A050C050E05100512051405160518051A051C051E05200522052405260531-055610A0-10C510C710CD1E001E021E041E061E081E0A1E0C1E0E1E101E121E141E161E181E1A1E1C1E1E1E201E221E241E261E281E2A1E2C1E2E1E301E321E341E361E381E3A1E3C1E3E1E401E421E441E461E481E4A1E4C1E4E1E501E521E541E561E581E5A1E5C1E5E1E601E621E641E661E681E6A1E6C1E6E1E701E721E741E761E781E7A1E7C1E7E1E801E821E841E861E881E8A1E8C1E8E1E901E921E941E9E1EA01EA21EA41EA61EA81EAA1EAC1EAE1EB01EB21EB41EB61EB81EBA1EBC1EBE1EC01EC21EC41EC61EC81ECA1ECC1ECE1ED01ED21ED41ED61ED81EDA1EDC1EDE1EE01EE21EE41EE61EE81EEA1EEC1EEE1EF01EF21EF41EF61EF81EFA1EFC1EFE1F08-1F0F1F18-1F1D1F28-1F2F1F38-1F3F1F48-1F4D1F591F5B1F5D1F5F1F68-1F6F1FB8-1FBB1FC8-1FCB1FD8-1FDB1FE8-1FEC1FF8-1FFB21022107210B-210D2110-211221152119-211D212421262128212A-212D2130-2133213E213F214521832C00-2C2E2C602C62-2C642C672C692C6B2C6D-2C702C722C752C7E-2C802C822C842C862C882C8A2C8C2C8E2C902C922C942C962C982C9A2C9C2C9E2CA02CA22CA42CA62CA82CAA2CAC2CAE2CB02CB22CB42CB62CB82CBA2CBC2CBE2CC02CC22CC42CC62CC82CCA2CCC2CCE2CD02CD22CD42CD62CD82CDA2CDC2CDE2CE02CE22CEB2CED2CF2A640A642A644A646A648A64AA64CA64EA650A652A654A656A658A65AA65CA65EA660A662A664A666A668A66AA66CA680A682A684A686A688A68AA68CA68EA690A692A694A696A722A724A726A728A72AA72CA72EA732A734A736A738A73AA73CA73EA740A742A744A746A748A74AA74CA74EA750A752A754A756A758A75AA75CA75EA760A762A764A766A768A76AA76CA76EA779A77BA77DA77EA780A782A784A786A78BA78DA790A792A7A0A7A2A7A4A7A6A7A8A7AAFF21-FF3A",
    Mc: "0903093B093E-09400949-094C094E094F0982098309BE-09C009C709C809CB09CC09D70A030A3E-0A400A830ABE-0AC00AC90ACB0ACC0B020B030B3E0B400B470B480B4B0B4C0B570BBE0BBF0BC10BC20BC6-0BC80BCA-0BCC0BD70C01-0C030C41-0C440C820C830CBE0CC0-0CC40CC70CC80CCA0CCB0CD50CD60D020D030D3E-0D400D46-0D480D4A-0D4C0D570D820D830DCF-0DD10DD8-0DDF0DF20DF30F3E0F3F0F7F102B102C10311038103B103C105610571062-10641067-106D108310841087-108C108F109A-109C17B617BE-17C517C717C81923-19261929-192B193019311933-193819B0-19C019C819C91A19-1A1B1A551A571A611A631A641A6D-1A721B041B351B3B1B3D-1B411B431B441B821BA11BA61BA71BAA1BAC1BAD1BE71BEA-1BEC1BEE1BF21BF31C24-1C2B1C341C351CE11CF21CF3302E302FA823A824A827A880A881A8B4-A8C3A952A953A983A9B4A9B5A9BAA9BBA9BD-A9C0AA2FAA30AA33AA34AA4DAA7BAAEBAAEEAAEFAAF5ABE3ABE4ABE6ABE7ABE9ABEAABEC",
    Mn: "0300-036F0483-04870591-05BD05BF05C105C205C405C505C70610-061A064B-065F067006D6-06DC06DF-06E406E706E806EA-06ED07110730-074A07A6-07B007EB-07F30816-0819081B-08230825-08270829-082D0859-085B08E4-08FE0900-0902093A093C0941-0948094D0951-095709620963098109BC09C1-09C409CD09E209E30A010A020A3C0A410A420A470A480A4B-0A4D0A510A700A710A750A810A820ABC0AC1-0AC50AC70AC80ACD0AE20AE30B010B3C0B3F0B41-0B440B4D0B560B620B630B820BC00BCD0C3E-0C400C46-0C480C4A-0C4D0C550C560C620C630CBC0CBF0CC60CCC0CCD0CE20CE30D41-0D440D4D0D620D630DCA0DD2-0DD40DD60E310E34-0E3A0E47-0E4E0EB10EB4-0EB90EBB0EBC0EC8-0ECD0F180F190F350F370F390F71-0F7E0F80-0F840F860F870F8D-0F970F99-0FBC0FC6102D-10301032-10371039103A103D103E10581059105E-10601071-1074108210851086108D109D135D-135F1712-17141732-1734175217531772177317B417B517B7-17BD17C617C9-17D317DD180B-180D18A91920-19221927192819321939-193B1A171A181A561A58-1A5E1A601A621A65-1A6C1A73-1A7C1A7F1B00-1B031B341B36-1B3A1B3C1B421B6B-1B731B801B811BA2-1BA51BA81BA91BAB1BE61BE81BE91BED1BEF-1BF11C2C-1C331C361C371CD0-1CD21CD4-1CE01CE2-1CE81CED1CF41DC0-1DE61DFC-1DFF20D0-20DC20E120E5-20F02CEF-2CF12D7F2DE0-2DFF302A-302D3099309AA66FA674-A67DA69FA6F0A6F1A802A806A80BA825A826A8C4A8E0-A8F1A926-A92DA947-A951A980-A982A9B3A9B6-A9B9A9BCAA29-AA2EAA31AA32AA35AA36AA43AA4CAAB0AAB2-AAB4AAB7AAB8AABEAABFAAC1AAECAAEDAAF6ABE5ABE8ABEDFB1EFE00-FE0FFE20-FE26",
    Nd: "0030-00390660-066906F0-06F907C0-07C90966-096F09E6-09EF0A66-0A6F0AE6-0AEF0B66-0B6F0BE6-0BEF0C66-0C6F0CE6-0CEF0D66-0D6F0E50-0E590ED0-0ED90F20-0F291040-10491090-109917E0-17E91810-18191946-194F19D0-19D91A80-1A891A90-1A991B50-1B591BB0-1BB91C40-1C491C50-1C59A620-A629A8D0-A8D9A900-A909A9D0-A9D9AA50-AA59ABF0-ABF9FF10-FF19",
    Nl: "16EE-16F02160-21822185-218830073021-30293038-303AA6E6-A6EF",
    Pc: "005F203F20402054FE33FE34FE4D-FE4FFF3F"
  };

  var unicodeClass = function (abbrev) {
    return '[' +
      unicodeCategories[abbrev].replace(/[0-9A-F]{4}/ig, "\\u$&") + ']';
  };

  // See ECMA-262 spec, 3rd edition, Section 7.6
  // Match one or more characters that can start an identifier.
  // This is IdentifierStart+.
  var rIdentifierPrefix = new RegExp(
    "^([a-zA-Z$_]+|\\\\u[0-9a-fA-F]{4}|" +
      [unicodeClass('Lu'), unicodeClass('Ll'), unicodeClass('Lt'),
       unicodeClass('Lm'), unicodeClass('Lo'), unicodeClass('Nl')].join('|') +
      ")+");
  // Match one or more characters that can continue an identifier.
  // This is (IdentifierPart and not IdentifierStart)+.
  // To match a full identifier, match rIdentifierPrefix, then
  // match rIdentifierMiddle followed by rIdentifierPrefix until they both fail.
  var rIdentifierMiddle = new RegExp(
    "^([0-9]|" + [unicodeClass('Mn'), unicodeClass('Mc'), unicodeClass('Nd'),
                  unicodeClass('Pc')].join('|') + ")+");


  // See ECMA-262 spec, 3rd edition, Section 7.8.3
  var rHexLiteral = /^0[xX][0-9a-fA-F]+(?!\w)/;
  var rDecLiteral =
        /^(((0|[1-9][0-9]*)(\.[0-9]*)?)|\.[0-9]+)([Ee][+-]?[0-9]+)?(?!\w)/;

  // Section 7.8.4
  var rStringQuote = /^["']/;
  // Match one or more characters besides quotes, backslashes, or line ends
  var rStringMiddle = /^(?=.)[^"'\\]+?((?!.)|(?=["'\\]))/;
  // Match one escape sequence, including the backslash.
  var rEscapeSequence =
        /^\\(['"\\bfnrtv]|0(?![0-9])|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|(?=.)[^ux0-9])/;
  // Match one ES5 line continuation
  var rLineContinuation =
        /^\\(\r\n|[\u000A\u000D\u2028\u2029])/;


  BlazeTools.parseNumber = function (scanner) {
    var startPos = scanner.pos;

    var isNegative = false;
    if (scanner.peek() === '-') {
      scanner.pos++;
      isNegative = true;
    }
    // Note that we allow `"-0xa"`, unlike `Number(...)`.

    var rest = scanner.rest();
    var match = rDecLiteral.exec(rest) || rHexLiteral.exec(rest);
    if (! match) {
      scanner.pos = startPos;
      return null;
    }
    var matchText = match[0];
    scanner.pos += matchText.length;

    var text = (isNegative ? '-' : '') + matchText;
    var value = Number(matchText);
    value = (isNegative ? -value : value);
    return { text: text, value: value };
  };

  BlazeTools.parseIdentifierName = function (scanner) {
    var startPos = scanner.pos;
    var rest = scanner.rest();
    var match = rIdentifierPrefix.exec(rest);
    if (! match)
      return null;
    scanner.pos += match[0].length;
    rest = scanner.rest();
    var foundMore = true;

    while (foundMore) {
      foundMore = false;

      match = rIdentifierMiddle.exec(rest);
      if (match) {
        foundMore = true;
        scanner.pos += match[0].length;
        rest = scanner.rest();
      }

      match = rIdentifierPrefix.exec(rest);
      if (match) {
        foundMore = true;
        scanner.pos += match[0].length;
        rest = scanner.rest();
      }
    }

    return scanner.input.substring(startPos, scanner.pos);
  };

  BlazeTools.parseExtendedIdentifierName = function (scanner) {
    // parse an identifier name optionally preceded by '@'
    if (scanner.peek() === '@') {
      scanner.pos++;
      var afterAt = BlazeTools.parseIdentifierName(scanner);
      if (afterAt) {
        return '@' + afterAt;
      } else {
        scanner.pos--;
        return null;
      }
    } else {
      return BlazeTools.parseIdentifierName(scanner);
    }
  };

  BlazeTools.parseStringLiteral = function (scanner) {
    var startPos = scanner.pos;
    var rest = scanner.rest();
    var match = rStringQuote.exec(rest);
    if (! match)
      return null;

    var quote = match[0];
    scanner.pos++;
    rest = scanner.rest();

    var jsonLiteral = '"';

    while (match) {
      match = rStringMiddle.exec(rest);
      if (match) {
        jsonLiteral += match[0];
      } else {
        match = rEscapeSequence.exec(rest);
        if (match) {
          var esc = match[0];
          // Convert all string escapes to JSON-compatible string escapes, so we
          // can use JSON.parse for some of the work.  JSON strings are not the
          // same as JS strings.  They don't support `\0`, `\v`, `\'`, or hex
          // escapes.
          if (esc === '\\0')
            jsonLiteral += '\\u0000';
          else if (esc === '\\v')
            // Note: IE 8 doesn't correctly parse '\v' in JavaScript.
            jsonLiteral += '\\u000b';
          else if (esc.charAt(1) === 'x')
            jsonLiteral += '\\u00' + esc.slice(2);
          else if (esc === '\\\'')
            jsonLiteral += "'";
          else
            jsonLiteral += esc;
        } else {
          match = rLineContinuation.exec(rest);
          if (! match) {
            match = rStringQuote.exec(rest);
            if (match) {
              var c = match[0];
              if (c !== quote) {
                if (c === '"')
                  jsonLiteral += '\\';
                jsonLiteral += c;
              }
            }
          }
        }
      }
      if (match) {
        scanner.pos += match[0].length;
        rest = scanner.rest();
        if (match[0] === quote)
          break;
      }
    }

    if (! match || match[0] !== quote)
      scanner.fatal("Unterminated string literal");

    jsonLiteral += '"';
    var text = scanner.input.substring(startPos, scanner.pos);
    var value = JSON.parse(jsonLiteral);
    return { text: text, value: value };
  };





  // ============================================================
// Code-generation of template tags

// The `CodeGen` class currently has no instance state, but in theory
// it could be useful to track per-function state, like whether we
// need to emit `var self = this` or not.
var CodeGen = SpacebarsCompilerMine.CodeGen = function () {};

var builtInBlockHelpers = SpacebarsCompilerMine._builtInBlockHelpers = {
  'if': 'BlazeMine.If',
  'unless': 'BlazeMine.Unless',
  'with': 'SpacebarsMine.With',
  'each': 'BlazeMine.Each',
  'let': 'BlazeMine.Let'
};


// Mapping of "macros" which, when preceded by `Template.`, expand
// to special code rather than following the lookup rules for dotted
// symbols.
var builtInTemplateMacros = {
  // `view` is a local variable defined in the generated render
  // function for the template in which `Template.contentBlock` or
  // `Template.elseBlock` is invoked.
  'contentBlock': 'view.templateContentBlock',
  'elseBlock': 'view.templateElseBlock',

  // Confusingly, this makes `{{> Template.dynamic}}` an alias
  // for `{{> __dynamic}}`, where "__dynamic" is the template that
  // implements the dynamic template feature.
  'dynamic': 'Template.__dynamic',

  'subscriptionsReady': 'true'
};

var additionalReservedNames = ["body", "toString", "instance",  "constructor",
  "toString", "toLocaleString", "valueOf", "hasOwnProperty", "isPrototypeOf",
  "propertyIsEnumerable", "__defineGetter__", "__lookupGetter__",
  "__defineSetter__", "__lookupSetter__", "__proto__", "dynamic",
  "registerHelper", "currentData", "parentData"];

// A "reserved name" can't be used as a <template> name.  This
// function is used by the template file scanner.
//
// Note that the runtime imposes additional restrictions, for example
// banning the name "body" and names of built-in object properties
// like "toString".
SpacebarsCompilerMine.isReservedName = function (name) {
  return builtInBlockHelpers.hasOwnProperty(name) ||
    builtInTemplateMacros.hasOwnProperty(name) ||
    _.indexOf(additionalReservedNames, name) > -1;
};

var makeObjectLiteral = function (obj) {
  var parts = [];
  for (var k in obj)
    parts.push(BlazeTools.toObjectLiteralKey(k) + ': ' + obj[k]);
  return '{' + parts.join(', ') + '}';
};

_.extend(CodeGen.prototype, {
  codeGenTemplateTag: function (tag) {
    var self = this;
    if (tag.position === HTMLTools.TEMPLATE_TAG_POSITION.IN_START_TAG) {
      // Special dynamic attributes: `<div {{attrs}}>...`
      // only `tag.type === 'DOUBLE'` allowed (by earlier validation)
      return BlazeTools.EmitCode('function () { return ' +
          self.codeGenMustache(tag.path, tag.args, 'attrMustache')
          + '; }');
    } else {
      if (tag.type === 'DOUBLE' || tag.type === 'TRIPLE') {
        var code = self.codeGenMustache(tag.path, tag.args);
        if (tag.type === 'TRIPLE') {
          code = 'SpacebarsMine.makeRaw(' + code + ')';
        }
        if (tag.position !== HTMLTools.TEMPLATE_TAG_POSITION.IN_ATTRIBUTE) {
          // Reactive attributes are already wrapped in a function,
          // and there's no fine-grained reactivity.
          // Anywhere else, we need to create a View.
          code = 'BlazeMine.View(' +
            BlazeTools.toJSLiteral('lookup:' + tag.path.join('.')) + ', ' +
            'function () { return ' + code + '; })';
        }
        return BlazeTools.EmitCode(code);
      } else if (tag.type === 'INCLUSION' || tag.type === 'BLOCKOPEN') {
        var path = tag.path;
        var args = tag.args;

        if (tag.type === 'BLOCKOPEN' &&
            builtInBlockHelpers.hasOwnProperty(path[0])) {
          // if, unless, with, each.
          //
          // If someone tries to do `{{> if}}`, we don't
          // get here, but an error is thrown when we try to codegen the path.

          // Note: If we caught these errors earlier, while scanning, we'd be able to
          // provide nice line numbers.
          if (path.length > 1)
            throw new Error("Unexpected dotted path beginning with " + path[0]);
          if (! args.length)
            throw new Error("#" + path[0] + " requires an argument");

          var dataCode = null;
          // #each has a special treatment as it features two different forms:
          // - {{#each people}}
          // - {{#each person in people}}
          if (path[0] === 'each' && args.length >= 2 && args[1][0] === 'PATH' &&
              args[1][1].length && args[1][1][0] === 'in') {
            // minimum conditions are met for each-in.  now validate this
            // isn't some weird case.
            var eachUsage = "Use either {{#each items}} or " +
                  "{{#each item in items}} form of #each.";
            var inArg = args[1];
            if (! (args.length >= 3 && inArg[1].length === 1)) {
              // we don't have at least 3 space-separated parts after #each, or
              // inArg doesn't look like ['PATH',['in']]
              throw new Error("Malformed #each. " + eachUsage);
            }
            // split out the variable name and sequence arguments
            var variableArg = args[0];
            if (! (variableArg[0] === "PATH" && variableArg[1].length === 1 &&
                   variableArg[1][0].replace(/\./g, ''))) {
              throw new Error("Bad variable name in #each");
            }
            var variable = variableArg[1][0];
            dataCode = 'function () { return { _sequence: ' +
              self.codeGenInclusionData(args.slice(2)) +
              ', _variable: ' + BlazeTools.toJSLiteral(variable) + ' }; }';
          } else if (path[0] === 'let') {
            var dataProps = {};
            _.each(args, function (arg) {
              if (arg.length !== 3) {
                // not a keyword arg (x=y)
                throw new Error("Incorrect form of #let");
              }
              var argKey = arg[2];
              dataProps[argKey] =
                'function () { return SpacebarsMine.call(' +
                self.codeGenArgValue(arg) + '); }';
            });
            dataCode = makeObjectLiteral(dataProps);
          }

          if (! dataCode) {
            // `args` must exist (tag.args.length > 0)
            dataCode = self.codeGenInclusionDataFunc(args) || 'null';
          }

          // `content` must exist
          var contentBlock = (('content' in tag) ?
                              self.codeGenBlock(tag.content) : null);
          // `elseContent` may not exist
          var elseContentBlock = (('elseContent' in tag) ?
                                  self.codeGenBlock(tag.elseContent) : null);

          var callArgs = [dataCode, contentBlock];
          if (elseContentBlock)
            callArgs.push(elseContentBlock);

          return BlazeTools.EmitCode(
            builtInBlockHelpers[path[0]] + '(' + callArgs.join(', ') + ')');

        } else {
          var compCode = self.codeGenPath(path, {lookupTemplate: true});
          if (path.length > 1) {
            // capture reactivity
            compCode = 'function () { return SpacebarsMine.call(' + compCode +
              '); }';
          }

          var dataCode = self.codeGenInclusionDataFunc(tag.args);
          var content = (('content' in tag) ?
                         self.codeGenBlock(tag.content) : null);
          var elseContent = (('elseContent' in tag) ?
                             self.codeGenBlock(tag.elseContent) : null);

          var includeArgs = [compCode];
          if (content) {
            includeArgs.push(content);
            if (elseContent)
              includeArgs.push(elseContent);
          }

          var includeCode =
                'SpacebarsMine.include(' + includeArgs.join(', ') + ')';

          // calling convention compat -- set the data context around the
          // entire inclusion, so that if the name of the inclusion is
          // a helper function, it gets the data context in `this`.
          // This makes for a pretty confusing calling convention --
          // In `{{#foo bar}}`, `foo` is evaluated in the context of `bar`
          // -- but it's what we shipped for 0.8.0.  The rationale is that
          // `{{#foo bar}}` is sugar for `{{#with bar}}{{#foo}}...`.
          if (dataCode) {
            includeCode =
              'BlazeMine._TemplateWith(' + dataCode + ', function () { return ' +
              includeCode + '; })';
          }

          // XXX BACK COMPAT - UI is the old name, Template is the new
          if ((path[0] === 'UI' || path[0] === 'Template') &&
              (path[1] === 'contentBlock' || path[1] === 'elseBlock')) {
            // Call contentBlock and elseBlock in the appropriate scope
            includeCode = 'BlazeMine._InOuterTemplateScope(view, function () { return '
              + includeCode + '; })';
          }

          return BlazeTools.EmitCode(includeCode);
        }
      } else if (tag.type === 'ESCAPE') {
        return tag.value;
      } else {
        // Can't get here; TemplateTag validation should catch any
        // inappropriate tag types that might come out of the parser.
        throw new Error("Unexpected template tag type: " + tag.type);
      }
    }
  },

  // `path` is an array of at least one string.
  //
  // If `path.length > 1`, the generated code may be reactive
  // (i.e. it may invalidate the current computation).
  //
  // No code is generated to call the result if it's a function.
  //
  // Options:
  //
  // - lookupTemplate {Boolean} If true, generated code also looks in
  //   the list of templates. (After helpers, before data context).
  //   Used when generating code for `{{> foo}}` or `{{#foo}}`. Only
  //   used for non-dotted paths.
  codeGenPath: function (path, opts) {
    if (builtInBlockHelpers.hasOwnProperty(path[0]))
      throw new Error("Can't use the built-in '" + path[0] + "' here");
    // Let `{{#if Template.contentBlock}}` check whether this template was
    // invoked via inclusion or as a block helper, in addition to supporting
    // `{{> Template.contentBlock}}`.
    // XXX BACK COMPAT - UI is the old name, Template is the new
    if (path.length >= 2 &&
        (path[0] === 'UI' || path[0] === 'Template')
        && builtInTemplateMacros.hasOwnProperty(path[1])) {
      if (path.length > 2)
        throw new Error("Unexpected dotted path beginning with " +
                        path[0] + '.' + path[1]);
      return builtInTemplateMacros[path[1]];
    }

    var firstPathItem = BlazeTools.toJSLiteral(path[0]);
    var lookupMethod = 'lookup';
    if (opts && opts.lookupTemplate && path.length === 1)
      lookupMethod = 'lookupTemplate';
    var code = 'view.' + lookupMethod + '(' + firstPathItem + ')';

    if (path.length > 1) {
      code = 'SpacebarsMine.dot(' + code + ', ' +
        _.map(path.slice(1), BlazeTools.toJSLiteral).join(', ') + ')';
    }

    return code;
  },

  // Generates code for an `[argType, argValue]` argument spec,
  // ignoring the third element (keyword argument name) if present.
  //
  // The resulting code may be reactive (in the case of a PATH of
  // more than one element) and is not wrapped in a closure.
  codeGenArgValue: function (arg) {
    var self = this;

    var argType = arg[0];
    var argValue = arg[1];

    var argCode;
    switch (argType) {
    case 'STRING':
    case 'NUMBER':
    case 'BOOLEAN':
    case 'NULL':
      argCode = BlazeTools.toJSLiteral(argValue);
      break;
    case 'PATH':
      argCode = self.codeGenPath(argValue);
      break;
    case 'EXPR':
      // The format of EXPR is ['EXPR', { type: 'EXPR', path: [...], args: { ... } }]
      argCode = self.codeGenMustache(argValue.path, argValue.args, 'dataMustache');
      break;
    default:
      // can't get here
      throw new Error("Unexpected arg type: " + argType);
    }

    return argCode;
  },

  // Generates a call to `SpacebarsMine.fooMustache` on evaluated arguments.
  // The resulting code has no function literals and must be wrapped in
  // one for fine-grained reactivity.
  codeGenMustache: function (path, args, mustacheType) {
    var self = this;

    var nameCode = self.codeGenPath(path);
    var argCode = self.codeGenMustacheArgs(args);
    var mustache = (mustacheType || 'mustache');

    return 'SpacebarsMine.' + mustache + '(' + nameCode +
      (argCode ? ', ' + argCode.join(', ') : '') + ')';
  },

  // returns: array of source strings, or null if no
  // args at all.
  codeGenMustacheArgs: function (tagArgs) {
    var self = this;

    var kwArgs = null; // source -> source
    var args = null; // [source]

    // tagArgs may be null
    _.each(tagArgs, function (arg) {
      var argCode = self.codeGenArgValue(arg);

      if (arg.length > 2) {
        // keyword argument (represented as [type, value, name])
        kwArgs = (kwArgs || {});
        kwArgs[arg[2]] = argCode;
      } else {
        // positional argument
        args = (args || []);
        args.push(argCode);
      }
    });

    // put kwArgs in options dictionary at end of args
    if (kwArgs) {
      args = (args || []);
      args.push('SpacebarsMine.kw(' + makeObjectLiteral(kwArgs) + ')');
    }

    return args;
  },

  codeGenBlock: function (content) {
    return SpacebarsCompilerMine.codeGen(content);
  },

  codeGenInclusionData: function (args) {
    var self = this;

    if (! args.length) {
      // e.g. `{{#foo}}`
      return null;
    } else if (args[0].length === 3) {
      // keyword arguments only, e.g. `{{> point x=1 y=2}}`
      var dataProps = {};
      _.each(args, function (arg) {
        var argKey = arg[2];
        dataProps[argKey] = 'SpacebarsMine.call(' + self.codeGenArgValue(arg) + ')';
      });
      return makeObjectLiteral(dataProps);
    } else if (args[0][0] !== 'PATH') {
      // literal first argument, e.g. `{{> foo "blah"}}`
      //
      // tag validation has confirmed, in this case, that there is only
      // one argument (`args.length === 1`)
      return self.codeGenArgValue(args[0]);
    } else if (args.length === 1) {
      // one argument, must be a PATH
      return 'SpacebarsMine.call(' + self.codeGenPath(args[0][1]) + ')';
    } else {
      // Multiple positional arguments; treat them as a nested
      // "data mustache"
      return self.codeGenMustache(args[0][1], args.slice(1),
                                  'dataMustache');
    }

  },

  codeGenInclusionDataFunc: function (args) {
    var self = this;
    var dataCode = self.codeGenInclusionData(args);
    if (dataCode) {
      return 'function () { return ' + dataCode + '; }';
    } else {
      return null;
    }
  }

});


BlazeTools.EmitCode = function (value) {
    if (! (this instanceof BlazeTools.EmitCode))
      // called without `new`
      return new BlazeTools.EmitCode(value);

    if (typeof value !== 'string')
      throw new Error('BlazeTools.EmitCode must be constructed with a string');

    this.value = value;
  };
  BlazeTools.EmitCode.prototype.toJS = function (visitor) {
    return this.value;
  };

  // Turns any JSONable value into a JavaScript literal.
  toJSLiteral = function (obj) {
    // See <http://timelessrepo.com/json-isnt-a-javascript-subset> for `\u2028\u2029`.
    // Also escape Unicode surrogates.
    return (JSON.stringify(obj)
            .replace(/[\u2028\u2029\ud800-\udfff]/g, function (c) {
              return '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4);
            }));
  };
  BlazeTools.toJSLiteral = toJSLiteral;



  var jsReservedWordSet = (function (set) {
    _.each("abstract else instanceof super boolean enum int switch break export interface synchronized byte extends let this case false long throw catch final native throws char finally new transient class float null true const for package try continue function private typeof debugger goto protected var default if public void delete implements return volatile do import short while double in static with".split(' '), function (w) {
      set[w] = 1;
    });
    return set;
  })({});

  toObjectLiteralKey = function (k) {
    if (/^[a-zA-Z$_][a-zA-Z$0-9_]*$/.test(k) && jsReservedWordSet[k] !== 1)
      return k;
    return toJSLiteral(k);
  };
  BlazeTools.toObjectLiteralKey = toObjectLiteralKey;

  var hasToJS = function (x) {
    return x.toJS && (typeof (x.toJS) === 'function');
  };

  ToJSVisitor = HTMLMine.Visitor.extend();
  ToJSVisitor.def({
    visitNull: function (nullOrUndefined) {
      return 'null';
    },
    visitPrimitive: function (stringBooleanOrNumber) {
      return toJSLiteral(stringBooleanOrNumber);
    },
    visitArray: function (array) {
      var parts = [];
      for (var i = 0; i < array.length; i++)
        parts.push(this.visit(array[i]));
      return '[' + parts.join(', ') + ']';
    },
    visitTag: function (tag) {
      return this.generateCall(tag.tagName, tag.attrs, tag.children);
    },
    visitComment: function (comment) {
      return this.generateCall('HTMLMine.Comment', null, [comment.value]);
    },
    visitCharRef: function (charRef) {
      return this.generateCall('HTMLMine.CharRef',
                               {html: charRef.html, str: charRef.str});
    },
    visitRaw: function (raw) {
      return this.generateCall('HTMLMine.Raw', null, [raw.value]);
    },
    visitObject: function (x) {
      if (hasToJS(x)) {
        return x.toJS(this);
      }

      throw new Error("Unexpected object in HTMLjs in toJS: " + x);
    },
    generateCall: function (name, attrs, children) {
      var tagSymbol;
      if (name.indexOf('.') >= 0) {
        tagSymbol = name;
      } else if (HTMLMine.isTagEnsured(name)) {
        tagSymbol = 'HTMLMine.' + HTMLMine.getSymbolName(name);
      } else {
        tagSymbol = 'HTMLMine.getTag(' + toJSLiteral(name) + ')';
      }

      var attrsArray = null;
      if (attrs) {
        attrsArray = [];
        var needsHTMLAttrs = false;
        if (HTMLMine.isArray(attrs)) {
          var attrsArray = [];
          for (var i = 0; i < attrs.length; i++) {
            var a = attrs[i];
            if (hasToJS(a)) {
              attrsArray.push(a.toJS(this));
              needsHTMLAttrs = true;
            } else {
              var attrsObjStr = this.generateAttrsDictionary(attrs[i]);
              if (attrsObjStr !== null)
                attrsArray.push(attrsObjStr);
            }
          }
        } else if (hasToJS(attrs)) {
          attrsArray.push(attrs.toJS(this));
          needsHTMLAttrs = true;
        } else {
          attrsArray.push(this.generateAttrsDictionary(attrs));
        }
      }
      var attrsStr = null;
      if (attrsArray && attrsArray.length) {
        if (attrsArray.length === 1 && ! needsHTMLAttrs) {
          attrsStr = attrsArray[0];
        } else {
          attrsStr = 'HTMLMine.Attrs(' + attrsArray.join(', ') + ')';
        }
      }

      var argStrs = [];
      if (attrsStr !== null)
        argStrs.push(attrsStr);

      if (children) {
        for (var i = 0; i < children.length; i++)
          argStrs.push(this.visit(children[i]));
      }

      return tagSymbol + '(' + argStrs.join(', ') + ')';
    },
    generateAttrsDictionary: function (attrsDict) {
      if (attrsDict.toJS && (typeof (attrsDict.toJS) === 'function')) {
        // not an attrs dictionary, but something else!  Like a template tag.
        return attrsDict.toJS(this);
      }

      var kvStrs = [];
      for (var k in attrsDict) {
        if (! HTMLMine.isNully(attrsDict[k]))
          kvStrs.push(toObjectLiteralKey(k) + ': ' +
                      this.visit(attrsDict[k]));
      }
      if (kvStrs.length)
        return '{' + kvStrs.join(', ') + '}';
      return null;
    }
  });
  BlazeTools.ToJSVisitor = ToJSVisitor;

  BlazeTools.toJS = function (content) {
    return (new ToJSVisitor).visit(content);
  };






  SpacebarsMine = {};

  var tripleEquals = function (a, b) { return a === b; };

  SpacebarsMine.include = function (templateOrFunction, contentFunc, elseFunc) {
    if (! templateOrFunction)
      return null;

    if (typeof templateOrFunction !== 'function') {
      var template = templateOrFunction;
      if (! template)
        throw new Error("Expected template or null, found: " + template);
      // console.log("Gandecki contentFunc", contentFunc);
      // console.log("Gandecki elseFunc", elseFunc);
      console.log("Gandecki templateOrFunction", templateOrFunction);
      var view = templateOrFunction.constructView(contentFunc, elseFunc);
      view.__startsNewLexicalScope = true;
      return view;
    }

    var templateVar = new ReactiveVar(null, tripleEquals);
    var view = BlazeMine.View('SpacebarsMine.include', function () {
      var template = templateVar.get();
      if (template === null)
        return null;

      if (! template)
        throw new Error("Expected template or null, found: " + template);
      return template
      console.log("Gandecki template", template);
      return template.constructView(contentFunc, elseFunc);
    });
    view.__templateVar = templateVar;
    view.onViewCreated(function () {
      console.log("Gandecki templateOrFunction()", templateOrFunction());
        templateVar.set(templateOrFunction());
    });
    view.__startsNewLexicalScope = true;

    return view;
  };

  // Executes `{{foo bar baz}}` when called on `(foo, bar, baz)`.
  // If `bar` and `baz` are functions, they are called before
  // `foo` is called on them.
  //
  // This is the shared part of SpacebarsMine.mustache and
  // SpacebarsMine.attrMustache, which differ in how they post-process the
  // result.
  SpacebarsMine.mustacheImpl = function (value/*, args*/) {
    var args = arguments;
    // if we have any arguments (pos or kw), add an options argument
    // if there isn't one.
    if (args.length > 1) {
      var kw = args[args.length - 1];
      if (! (kw instanceof SpacebarsMine.kw)) {
        kw = SpacebarsMine.kw();
        // clone arguments into an actual array, then push
        // the empty kw object.
        args = Array.prototype.slice.call(arguments);
        args.push(kw);
      } else {
        // For each keyword arg, call it if it's a function
        var newHash = {};
        for (var k in kw.hash) {
          var v = kw.hash[k];
          newHash[k] = (typeof v === 'function' ? v() : v);
        }
        args[args.length - 1] = SpacebarsMine.kw(newHash);
      }
    }

    return SpacebarsMine.call.apply(null, args);
  };

  SpacebarsMine.mustache = function (value/*, args*/) {
    var result = SpacebarsMine.mustacheImpl.apply(null, arguments);

    if (result instanceof SpacebarsMine.SafeString)
      return HTMLMine.Raw(result.toString());
    else
      // map `null`, `undefined`, and `false` to null, which is important
      // so that attributes with nully values are considered absent.
      // stringify anything else (e.g. strings, booleans, numbers including 0).
      return (result == null || result === false) ? null : String(result);
  };

  SpacebarsMine.attrMustache = function (value/*, args*/) {
    var result = SpacebarsMine.mustacheImpl.apply(null, arguments);

    if (result == null || result === '') {
      return null;
    } else if (typeof result === 'object') {
      return result;
    } else if (typeof result === 'string' && HTMLMine.isValidAttributeName(result)) {
      var obj = {};
      obj[result] = '';
      return obj;
    } else {
      throw new Error("Expected valid attribute name, '', null, or object");
    }
  };

  SpacebarsMine.dataMustache = function (value/*, args*/) {
    var result = SpacebarsMine.mustacheImpl.apply(null, arguments);

    return result;
  };

  // Idempotently wrap in `HTMLMine.Raw`.
  //
  // Called on the return value from `SpacebarsMine.mustache` in case the
  // template uses triple-stache (`{{{foo bar baz}}}`).
  SpacebarsMine.makeRaw = function (value) {
    if (value == null) // null or undefined
      return null;
    else if (value instanceof HTMLMine.Raw)
      return value;
    else
      return HTMLMine.Raw(value);
  };

  // If `value` is a function, evaluate its `args` (by calling them, if they
  // are functions), and then call it on them. Otherwise, return `value`.
  //
  // If `value` is not a function and is not null, then this method will assert
  // that there are no args. We check for null before asserting because a user
  // may write a template like {{user.fullNameWithPrefix 'Mr.'}}, where the
  // function will be null until data is ready.
  SpacebarsMine.call = function (value/*, args*/) {
    if (typeof value === 'function') {
      // Evaluate arguments by calling them if they are functions.
      var newArgs = [];
      for (var i = 1; i < arguments.length; i++) {
        var arg = arguments[i];
        newArgs[i-1] = (typeof arg === 'function' ? arg() : arg);
      }

      return value.apply(null, newArgs);
    } else {
      if (value != null && arguments.length > 1) {
        throw new Error("Can't call non-function: " + value);
      }
      return value;
    }
  };

  // Call this as `SpacebarsMine.kw({ ... })`.  The return value
  // is `instanceof SpacebarsMine.kw`.
  SpacebarsMine.kw = function (hash) {
    if (! (this instanceof SpacebarsMine.kw))
      // called without new; call with new
      return new SpacebarsMine.kw(hash);

    this.hash = hash || {};
  };

  // Call this as `SpacebarsMine.SafeString("some HTML")`.  The return value
  // is `instanceof SpacebarsMine.SafeString` (and `instanceof Handlebars.SafeString).
  SpacebarsMine.SafeString = function (html) {
    if (! (this instanceof SpacebarsMine.SafeString))
      // called without new; call with new
      return new SpacebarsMine.SafeString(html);

    return new Handlebars.SafeString(html);
  };
  //GOZDECKI zakomentowana linia
//   SpacebarsMine.SafeString.prototype = Handlebars.SafeString.prototype;

  // `SpacebarsMine.dot(foo, "bar", "baz")` performs a special kind
  // of `foo.bar.baz` that allows safe indexing of `null` and
  // indexing of functions (which calls the function).  If the
  // result is a function, it is always a bound function (e.g.
  // a wrapped version of `baz` that always uses `foo.bar` as
  // `this`).
  //
  // In `SpacebarsMine.dot(foo, "bar")`, `foo` is assumed to be either
  // a non-function value or a "fully-bound" function wrapping a value,
  // where fully-bound means it takes no arguments and ignores `this`.
  //
  // `SpacebarsMine.dot(foo, "bar")` performs the following steps:
  //
  // * If `foo` is falsy, return `foo`.
  //
  // * If `foo` is a function, call it (set `foo` to `foo()`).
  //
  // * If `foo` is falsy now, return `foo`.
  //
  // * Return `foo.bar`, binding it to `foo` if it's a function.
  SpacebarsMine.dot = function (value, id1/*, id2, ...*/) {
    if (arguments.length > 2) {
      // Note: doing this recursively is probably less efficient than
      // doing it in an iterative loop.
      var argsForRecurse = [];
      argsForRecurse.push(SpacebarsMine.dot(value, id1));
      argsForRecurse.push.apply(argsForRecurse,
                                Array.prototype.slice.call(arguments, 2));
      return SpacebarsMine.dot.apply(null, argsForRecurse);
    }

    if (typeof value === 'function')
      value = value();

    if (! value)
      return value; // falsy, don't index, pass through

    var result = value[id1];
    if (typeof result !== 'function')
      return result;
    // `value[id1]` (or `value()[id1]`) is a function.
    // Bind it so that when called, `value` will be placed in `this`.
    return function (/*arguments*/) {
      return result.apply(value, arguments);
    };
  };

  // SpacebarsMine.With implements the conditional logic of rendering
  // the `{{else}}` block if the argument is falsy.  It combines
  // a BlazeMine.If with a BlazeMine.With (the latter only in the truthy
  // case, since the else block is evaluated without entering
  // a new data context).
  SpacebarsMine.With = function (argFunc, contentFunc, elseFunc) {
    var argVar = new ReactiveVar;
    var view = BlazeMine.View('Spacebars_with', function () {
      return BlazeMine.If(function () { return argVar.get(); },
                      function () { return BlazeMine.With(function () {
                        return argVar.get(); }, contentFunc); },
                      elseFunc);
    });
    view.onViewCreated(function () {
      // this.autorun(function () {
        argVar.set(argFunc());

        // This is a hack so that autoruns inside the body
        // of the #with get stopped sooner.  It reaches inside
        // our ReactiveVar to access its dep.

        // Tracker.onInvalidate(function () {
        //   argVar.dep.changed();
        // });

        // Take the case of `{{#with A}}{{B}}{{/with}}`.  The goal
        // is to not re-render `B` if `A` changes to become falsy
        // and `B` is simultaneously invalidated.
        //
        // A series of autoruns are involved:
        //
        // 1. This autorun (argument to SpacebarsMine.With)
        // 2. Argument to BlazeMine.If
        // 3. BlazeMine.If view re-render
        // 4. Argument to BlazeMine.With
        // 5. The template tag `{{B}}`
        //
        // When (3) is invalidated, it immediately stops (4) and (5)
        // because of a Tracker.onInvalidate built into materializeView.
        // (When a View's render method is invalidated, it immediately
        // tears down all the subviews, via a Tracker.onInvalidate much
        // like this one.
        //
        // Suppose `A` changes to become falsy, and `B` changes at the
        // same time (i.e. without an intervening flush).
        // Without the code above, this happens:
        //
        // - (1) and (5) are invalidated.
        // - (1) runs, invalidating (2) and (4).
        // - (5) runs.
        // - (2) runs, invalidating (3), stopping (4) and (5).
        //
        // With the code above:
        //
        // - (1) and (5) are invalidated, invalidating (2) and (4).
        // - (1) runs.
        // - (2) runs, invalidating (3), stopping (4) and (5).
        //
        // If the re-run of (5) is originally enqueued before (1), all
        // bets are off, but typically that doesn't seem to be the
        // case.  Anyway, doing this is always better than not doing it,
        // because it might save a bunch of DOM from being updated
        // needlessly.
      // });
    });

    return view;
  };
