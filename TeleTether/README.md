# TeleTether

Telegram Web K 左側聊天清單優化原型。

## 目前版本：0.1.0

第一個原型只驗證一件事：**阻止既有聊天項目因一般對話更新而重新排序，同時保留訊息預覽與未讀狀態更新。**

### 安裝

使用 Tampermonkey 或 Violentmonkey，開啟 [TeleTether.user.js](https://raw.githubusercontent.com/Mr-holysheep/storage/main/TeleTether/TeleTether.user.js) 安裝，然後重新載入 Telegram Web K。

### 目前做法

利用 Telegram Web K 公開在頁面環境中的 `appDialogsManager`，接上各個 `AutonomousDialogList`：

1. 包裝 `AutonomousDialogListBase.updateDialog()`。
2. 當這個方法呼叫 `SortedDialogList.update()` 時，若排序凍結已啟用，就略過這次索引更新。
3. Telegram 原本的 `setLastMessageN()` 仍照常執行，因此訊息預覽與未讀更新不應受影響。
4. 新增、刪除聊天項目及其他不經這條呼叫路徑的操作，暫時不主動攔截。

### 操作

透過使用者腳本管理器的腳本選單操作：

- **切換排序凍結**：開啟／關閉原型功能。
- **查看狀態**：顯示連線、已接管清單數及略過排序更新次數。
- **撤銷攔截**：還原本次注入的函式包裝；重新載入頁面可重新啟用。

也可以在 Telegram 頁面的開發者主控台使用：

```js
TeleTether.freeze();
TeleTether.unfreeze();
TeleTether.toggle();
TeleTether.status();
TeleTether.restore();
```

凍結狀態目前只存在於當前頁面工作階段，重新載入後會恢復關閉。

### 原型限制與驗證重點

這不是完整排序引擎，也尚未在使用者的 Telegram 帳號上完成實測。

目前只攔截 `updateDialog() → sortedList.update()` 這條常見更新路徑。Telegram 仍可能透過其他路徑改變排序，例如置頂狀態、資料夾變更、清單重建或其他直接更新虛擬清單的操作。

測試時應確認：

- 啟用凍結後，已存在的聊天收到新訊息時，位置是否保持不變。
- 最後訊息預覽、未讀數及未讀標記是否仍正常更新。
- 切換資料夾、置頂／取消置頂、重新載入後是否正常。
- 關閉凍結後，原生排序是否恢復。

若排序凍結有效但有其他更新路徑仍會移動項目，下一步應先定位那些路徑，不應直接擴大攔截範圍。

### 參考的 Telegram Web K 原始碼

- [AutonomousDialogListBase](https://github.com/morethanwords/tweb/blob/master/src/components/autonomousDialogList/base.ts)
- [SortedDialogList](https://github.com/morethanwords/tweb/blob/master/src/components/sortedDialogList.ts)
- [AppDialogsManager](https://github.com/morethanwords/tweb/blob/master/src/lib/appDialogsManager.ts)
- [DeferredSortedVirtualList](https://github.com/morethanwords/tweb/blob/master/src/components/deferredSortedVirtualList.tsx)
