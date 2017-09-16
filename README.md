# Blaze Renderer
Render blaze to html without Meteor context/dependency

This is a WIP repository for being able to render blaze templates without Meteor.

# Why would you want to do so?

Two reasons:
1) server-side rendering
2) testability

My goal is to be able to use wallabyjs with jest snapshots to test blaze templates.
The idea of Meteor internal testing was good, but it got left behind the great tools that the community brought. 

Look at this to understand what I'm talking about:

http://g.recordit.co/otCOmHvHoj.gif

# TODO

At this moment the blaze code is super messy, so once I get it to work, and have tests in place I will spend some time refactoring, and putting it in modules. Basically, remove the old Meteor way of doing everything-global, and get it to nicely organized import/export structure (similarly to what I've done with parts of minimongo here: https://github.com/lgandecki/modifyjs

For some reason {{#each}} inside {{#each}} inside {{#each}} doesn't work. 

