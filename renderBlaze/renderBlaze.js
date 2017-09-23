import html from './blazeInternals/html'
import compile from './blazeInternals/compiler'
import fs from 'fs';
import { html as beautifyHtml } from 'js-beautify'
import './blazeInternals/blazeWith'
import './mockTemplates'
import './mockReactiveVariable'
import returnAllTemplates from './returnAllTemplates'

var toHTML = function (data, template, templateName) {
    var compiled = compile(template, {isBody: true});

    var fn = eval(compiled);
    return BlazeMine.toHTML(BlazeMine.With(data, fn, templateName));
};

export const renderBlazeWithData = function renderBlaze(templateFile, templateName, data) {
    const include = function includeReplacement(templateName, data) {
        data = data || {};
        data = Object.assign({}, data, {includeReplacement})

        return toHTML(data, $(`template[name='${templateName}']`).html().toString().replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"'));
    }

    const template = fs.readFileSync(templateFile)
    var cheerio = require('cheerio');
    var $ = cheerio.load(template.toString().replace(/{{> *([^\s}]*)([^}]*)}}/g, '{{{ includeReplacement \'$1\' $2 }}}'));

    return beautifyHtml(include(templateName, data))
}


const renderBlaze = function (templateName) {

}

export default renderBlaze;
export const parseTemplates = function (templateFiles) {
    const templatesToFilesMap = []
    templateFiles.forEach((templateFile) => {
        const template = fs.readFileSync(templateFile)
        var cheerio = require('cheerio');
        //TODO add test cases for multiline {{> }}
        //TODO add test case for a case when {{> were}} <- no space
        $ = cheerio.load(template.toString().replace(/{{> *([^\s}]*)([^}]*)}}/g, '{{{ includeReplacement \'$1\' $2 }}}'));
        $('template').each((index, foundTemplate) => {
            templatesToFilesMap.push({templateName: $(foundTemplate).attr('name'), templateFile, cheerio: $})
        })
    })
    return templatesToFilesMap;
}

export const renderBlazeWithTemplates = function (templateName, parsedTemplates) {
  if (parsedTemplates && parsedTemplates.length > 0) {

  } else {
    parsedTemplates = parseTemplates(returnAllTemplates('imports/').concat(returnAllTemplates('client/')))
  }
    const includeReplacement = function includeReplacement(templateName) {
        const passedArguments = Array.from(arguments)[1] ? Array.from(arguments)[1]['hash'] : {}
        Template[templateName].helpers = Object.assign({}, Template[templateName].getHelpers(), passedArguments, {isInRole: function() { return true }}, {$or: function(arg1, arg2) { return arg1 || arg2}})

        //TODO add test for isInRole, and most probably make this configurable instead of hardcoded.
        // Used in https://github.com/alanning/meteor-roles
        data = Object.assign({}, Template[templateName].getHelpers(), {includeReplacement})

        let cheerio;
        cheerio = parsedTemplates.find(template => template.templateName === templateName).cheerio

        let template = cheerio(`template[name='${templateName}']`).html().toString().replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"');
        return toHTML(data, template, templateName);
    }
    return includeReplacement(templateName)
}


