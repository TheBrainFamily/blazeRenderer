module.exports = function (wallaby) {
    return {
        files: [
            'renderBlaze/**/*.js',
            '*.js',

            '*.json',
            '*.html',
            { pattern: '*.test.js', ignore: true }
        ],

        tests: [
            '*.test.js',
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
