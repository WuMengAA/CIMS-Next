// 一次性：把误入打包源目录的临时残件移出 Release/（不删除，避免触发 safe-delete 守卫）
const fs = require('fs');
const path = require('path');

const relDir = 'build/windows/x64/runner/Release';
const junkName = 'xingjikong.prev-runtime.exe';
const junk = path.join(relDir, junkName);
// 注意：必须留在同一卷（D:），跨卷 rename 会 EXDEV；且必须落在 Release/ 之外，否则仍会被打进包
const dst = 'D:/Stelarith/_trash-xjk/xingjikong.prev-runtime.exe';

fs.mkdirSync(path.dirname(dst), { recursive: true });
if (fs.existsSync(junk)) {
  fs.renameSync(junk, dst);
  console.log('moved out of packaging source -> ' + dst);
} else {
  console.log('already clean: ' + relDir);
}
console.log('still in Release/ ? ' + fs.existsSync(junk));
console.log('Release/ contents: ' + fs.readdirSync(relDir).join(', '));
