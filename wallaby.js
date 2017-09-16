module.exports = function (wallaby) {
    return {
        files: [
            'renderBlaze/**/*.js',
            '*.json',
            '*.html',
            { pattern: 'src/*.spec.js', ignore: true }
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
