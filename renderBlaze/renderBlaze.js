import html from './blazeInternals/html'
import compile from './blazeInternals/compiler'
import fs from 'fs';
import { html as beautifyHtml } from 'js-beautify'
import './blazeInternals/blazeWith'

var toHTML = function (data, template) {
  var compiled = compile(template, { isBody: true });
  var fn = eval(compiled);
  return BlazeMine.toHTML(BlazeMine.With(data, fn));
};

export default function renderBlaze(templateFile, templateName, data) {
  const include = function includeReplacement(templateName, data) {
    data = data || {};
    data = Object.assign({}, data, { includeReplacement })
    // console.log("template", template)
    var singleQuote = '&apos;';
    var re = new RegExp(singleQuote, 'g');
    return toHTML(data, $(`template[name='${templateName}']`).html().toString().replace(/&apos;/g, "'").replace(/&quot;/g, '"'));
  }

  const template = fs.readFileSync(templateFile)
  var cheerio = require('cheerio');
  $ = cheerio.load(template.toString().replace(/({{> *)(.*) }}/g, '{{{ includeReplacement \'$2\' }}}'));

  return beautifyHtml(include(templateName, data))
}