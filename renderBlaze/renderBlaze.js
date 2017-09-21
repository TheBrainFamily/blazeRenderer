import html from './blazeInternals/html'
import compile from './blazeInternals/compiler'
import fs from 'fs';
import { html as beautifyHtml } from 'js-beautify'
import './blazeInternals/blazeWith'
import './mockTemplates'
import './mockReactiveVariable'

var toHTML = function (data, template) {
    var compiled = compile(template, {isBody: true});
    var fn = eval(compiled);
    return BlazeMine.toHTML(BlazeMine.With(data, fn));
};

export const renderBlazeWithData = function renderBlaze(templateFile, templateName, data) {
    const include = function includeReplacement(templateName, data) {
        data = data || {};
        data = Object.assign({}, data, {includeReplacement})

        return toHTML(data, $(`template[name='${templateName}']`).html().toString().replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"'));
    }

    const template = fs.readFileSync(templateFile)
    var cheerio = require('cheerio');
    var $ = cheerio.load(template.toString().replace(/({{> *)([^\s]*) }}/g, '{{{ includeReplacement \'$2\' }}}'));

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
        $ = cheerio.load(template.toString().replace(/({{> *)([^\s]*) }}/g, '{{{ includeReplacement \'$2\' }}}'));
        $('template').each((index, foundTemplate) => {
            templatesToFilesMap.push({templateName: $(foundTemplate).attr('name'), templateFile, cheerio: $})
        })
    })
    return templatesToFilesMap;
}

export const renderBlazeWithTemplates = function (templateName, parsedTemplates) {
    const includeReplacement = function includeReplacement(templateName) {
        let data = Template[templateName].getHelpers() || {};
        data = Object.assign({}, data, {includeReplacement})
        let cheerio;
        cheerio = parsedTemplates.find(template => template.templateName === templateName).cheerio

        let template = cheerio(`template[name='${templateName}']`).html().toString().replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"');
        return toHTML(data, template);
    }
    return includeReplacement(templateName)
}


