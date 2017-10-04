import html from './blazeInternals/html'
import compile from './blazeInternals/compiler'
import fs from 'fs';
import { html as beautifyHtml } from 'js-beautify'
import './blazeInternals/blazeWith'
import './blazeInternals/template'
import './mockTemplates'
import './mockReactiveVariable'
import returnAllTemplates from './returnAllTemplates'

var toHTML = function (data, template, templateName, matchedInsideTemplates) {

    if (matchedInsideTemplates) {
      matchedInsideTemplates.forEach(insideTemplate => {
        var compiledInside = compile(insideTemplate.templateInside ,{isBody: true})
        var fnInside = eval(compiledInside)
        window.hackedInTemplates = {}
        window.hackedInTemplates[insideTemplate.name] = fnInside
      })
    }

    var compiled = compile(template, {isBody: true});
    var fn = eval(compiled)
    return BlazeMine.toHTML(BlazeMine.With(data, fn, templateName));
};

export const renderBlazeWithData = function renderBlaze(templateFile, templateName, data) {
    const include = function includeReplacement(templateName, data) {
        data = data || {};
        data = Object.assign({}, data, {includeReplacement})

		return toHTML(data, $(`template[name='${templateName}']`).html().toString().replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"'), templateName);
    }

    const template = fs.readFileSync(templateFile)
    var cheerio = require('cheerio');
    var $ = cheerio.load(template.toString().replace(/{{> *([^\s}]*)([^}]*)}}/g, '{{{ includeReplacement \'$1\' $2 }}}'));

    return beautifyHtml(include(templateName, data))
}

export const parseTemplates = function (templateFiles) {
  const templatesToFilesMap = []
  templateFiles.forEach((templateFile) => {
    const template = fs.readFileSync(templateFile)
    //TODO add test cases for multiline {{> }}
    //TODO add test case for a case when {{> were}} <- no space
    const parsedText = template.toString().replace(/{{(>) ?(Template.contentBlock)/g, '{{ $2').replace(/{{> *([^\s}]*)([^}]*)}}/g, '{{{ includeReplacement \'$1\' $2 }}}').replace(/({{|{{.*( |=))(this)( |}})/g, '$1_myOwnThis$4').replace(/&gt;/g, '>').replace(/&apos;/g, '\'').replace(/&quot;/g, '"')

    const templateRegex = /<template name=("|')(.*)("|')>((.|\n)*?)<\/template>/gm

    let match = templateRegex.exec(parsedText)

    while (match !== null) {
      templatesToFilesMap.push({templateName: match[2].trim(), templateFile, cheerio: match[4].trim()})
      match = templateRegex.exec(parsedText)
    }

  })
    return templatesToFilesMap;
}

const renderBlazeWithTemplates = function (templateName, parsedTemplates) {
  if (parsedTemplates && parsedTemplates.length > 0) {

  } else {
    parsedTemplates = parseTemplates(returnAllTemplates('imports/').concat(returnAllTemplates('client/')))
  }
    const includeReplacement = function includeReplacement(templateName) {
    let passedArguments;
    if (Array.from(arguments)[1] ) {
      passedArguments = Array.from(arguments)[1]['hash']  ? Array.from(arguments)[1]['hash'] : {_myOwnData: Array.from(arguments)[1]}
    }
        Template[templateName].helpers = Object.assign({}, Template[templateName].getHelpers(), passedArguments, {isInRole: function() { return true }}, {$or: function(arg1, arg2) { return arg1 || arg2}}, {$gt: function(arg1, arg2) { return arg1 > arg2}}, {$eq: function(arg1, arg2) { return arg1 === arg2 }}, {$exists: function(arg1) { return !!arg1 }}, {pathFor: function(arg1, arg2) { return `${arg1}/${arg2}`}}, {_myOwnThis: function() {return this._myOwnData}}, {$:{Session:{get: function(arg) { return true }}}})

      //TODO add test for isInRole, and most probably make this configurable instead of hardcoded.
      // Used in https://github.com/alanning/meteor-roles
      data = Object.assign({}, Template[templateName].getHelpers(), {includeReplacement})

      const cheerioPotentially = parsedTemplates.find(template => template.templateName === templateName)

      let template;
      if (!cheerioPotentially) {
        console.log("Gandecki templateName", templateName);
        template = '<div></div>'
      } else {
        template = cheerioPotentially.cheerio
      }
      // console.log(`${templateName} - ${template}`);

      let myRegexp = /{{ ?#(?!.*if|.*unless|.*each|.*with)([^ }]*).*/g

      let match = myRegexp.exec(template);

      let matchedInsideTemplateNames = []

      while (match !== null) {
        // matched text: match[0]
        // match start: match.index
        // capturing group n: match[n]
        matchedInsideTemplateNames.push(match[1].trim())
        match = myRegexp.exec(template);
      }


      let matchedInsideTemplates = matchedInsideTemplateNames.map(name => {
        let cheerioInside = parsedTemplates.find(template => template.templateName === name).cheerio
        let templateInside = cheerioInside
        return {templateInside, name}
      })


        return toHTML(data, template, templateName, matchedInsideTemplates);
    }
    return beautifyHtml(includeReplacement(templateName))
}

export default renderBlazeWithTemplates;
