import glob from 'glob'

export default function(path) {

  const value = [path].map(function (path) {
    console.log("Gandecki process.cwd()", process.cwd());
    if (path.match(/.*\*\*\/\*.html/)) {
      console.log("Gandecki glob.sync(path, {cwd: process.cwd()})", glob.sync(path, {cwd: process.cwd()}));
      return glob.sync(path, {cwd: process.cwd()})
    }

    if (path.match(/.*\.html/)) {
      console.log("Gandecki path", path);
      return path
    }
    console.log("Gandecki glob.sync(path + '/**/*.html', {cwd: process.cwd()})", glob.sync(path + '/**/*.html', {cwd: process.cwd()}));
    return glob.sync(path + '/**/*.html', {cwd: process.cwd()})
  }).reduce(function (a, b) {
    return a.concat(b)
  }, [])

  console.log("Gandecki value", value);
  return value;
}