import glob from 'glob'

export default function(path) {

  const value = [path].map(function (path) {
    if (path.match(/.*\*\*\/\*.html/)) {
      return glob.sync(path, {cwd: process.cwd()})
    }

    if (path.match(/.*\.html/)) {
      return path
    }
    return glob.sync(path + '/**/*.html', {cwd: process.cwd()})
  }).reduce(function (a, b) {
    return a.concat(b)
  }, [])

  return value;
}