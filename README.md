# Blaze Renderer
### We render blaze templates for you... so Meteor doesn't have to!
![Circle CI](https://circleci.com/gh/lgandecki/blazeRenderer.svg?style=shield)

Render blaze to html without loading Meteor context/dependencies

# Why would you want to do so?

Two reasons:
1) server-side rendering
2) testability

With this package you are able to use wallabyjs with jest snapshots to test blaze templates.
The idea of Meteor internal testing was good, but it got left behind the great tools that the community brought. 

Waiting for the Meteor to startup to run your tests is painful once you get used to the TDD immediate feedback loop that's possible in modern nodejs projects.

Look at this to understand what I'm talking about:

![demonstration](http://g.recordit.co/otCOmHvHoj.gif)

# Examples

Please take a look at [tests/template.test.js](tests/template.test.js) with coresponding files put inside [imports/client/lib](imports/client/lib) to see the usage.
To show a simle example:

```html
<template name="passDataToTemplate">
    {{#with dataSource}}
        <div>
            should display "some value" below
            {{> templateToPassDataTo key.value}}
        </div>
    {{/with}}
</template>

<template name="templateToPassDataTo">
    should displayed passed argument:
    this directly - {{this}}
    this through helper - {{displayHelper this}}
</template>
```

```javascript
Template.passDataToTemplate.helpers({
  dataSource: () => ({key: {value: "some value"}})
});
Template.templateToPassDataTo.helpers({
  displayHelper: value => value
});
```

and then
```javascript
import renderBlaze from 'blazeRenderer';
require('./passDataToTemplate')
const stringifiedHtml = renderBlaze('passDataToTemplate')
```

stringifiedHtml should end up being
```html
<div>
    should display "some value" below
    should displayed passed argument:
    this directly - some value
    this through helper - some value
</div>
```

This is obviously great to use with jest snapshots like so:
```javascript
it('template pass arguments properly', () => {
  require('./passDataToTemplate')
  expect(renderBlaze('passDataToTemplate')).toMatchSnapshot()
})
```

# TODO

At this moment the blaze code is super messy, so once I get it to work, and have tests in place I will spend some time refactoring, and putting it in modules. Basically, remove the old Meteor way of doing everything-global, and get it to nicely organized import/export structure (similarly to what I've done with parts of minimongo here: https://github.com/lgandecki/modifyjs )
