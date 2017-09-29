module.exports = function (wallaby) {
    return {
        files: [
            'blazeRenderer/**/*.js',
            '*.js',
            'tests/**/*.js',

            '*.json',
            '*.html',
            'tests/**/*.html',
            'imports/**/*.html',
            { pattern: 'tests/**/*.test.js', ignore: true }
        ],

        tests: [
            'tests/**/*.test.js',
        ],

        compilers: {
            '**/*.js': wallaby.compilers.babel()
        },

        env: {
            type: 'node'
        },
        testFramework: 'jest'
    }
};
