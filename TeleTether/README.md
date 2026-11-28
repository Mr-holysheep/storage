# TeleTether

Telegram Web K 左側聊天清單優化原型。

## 目前版本：0.1.1

第一個原型已驗證：常見的 `updateDialog() → sortedList.update()` 排序更新可被攔截，同時保留最後訊息預覽與未讀狀態更新。

0.1.1 在不擴大攔截範圍的前提下，加入虛擬清單變更診斷，用來定位仍會造成項目移動的其他路徑。

## 安裝／更新

使用 Tampermonkey 或 Violentmonkey，開啟 [TeleTether.user.js](https://raw.githubusercontent.com/Mr-holysheep/storage/main/TeleTether/TeleTether.user.js) 安裝或更新，然後重新載入 Telegram Web K。

## 排序凍結的目前做法

利用 Telegram Web K 公開在頁面環境中的 `appDialogsManager`，接上各個 `AutonomousDialogList`：

1. 包裝 `AutonomousDialogListBase.updateDialog()`。
2. 當這個方法呼叫 `SortedDialogList.update()` 時，若排序凍結已啟用，就略過這次索引更新。
3. Telegram 原本的 `setLastMessageN()` 仍照常執行，因此訊息預覽與未讀更新不受這項攔截影響。
4. 其他新增、刪除、置頂及清單重建操作仍交由 Telegram 處理。

## 操作

使用者腳本管理器選單提供：

- **切換排序凍結**：開啟／關閉原型功能。
- **查看狀態**：顯示連線、接管清單數及攔截次數。
- **開始更新路徑診斷**：開始記錄凍結期間的虛擬清單變更。
- **輸出診斷報告**：停止收集並在主控台輸出變更方法、項目 ID／索引與呼叫堆疊。
- **撤銷攔截**：還原本次注入的函式包裝。

也可以在 Telegram 頁面的開發者主控台使用：

```js
TeleTether.freeze();
TeleTether.unfreeze();
TeleTether.status();

// 啟動診斷後，再重現聊天項目移動
TeleTether.diagnostics(true);

// 重現完成後輸出報告
TeleTether.diagnostics(false);

// 或直接查看目前報告
TeleTether.report();
```

診斷只會在「凍結已啟用」時記錄以下虛擬清單變更：

- `updateItem`：修改既有項目的排序索引。
- `addItems`：加入一般項目。
- `addPinnedItems`／`ensurePinnedItems`：加入或確認置頂項目。
- `removeItem`／`removePinnedItem`：移除項目。
- `clear`：清空清單。

每筆紀錄包含呼叫堆疊，最多保留最近 150 筆。診斷本身不會阻止這些操作。

## 測試方式

1. 更新腳本並重新載入 Telegram Web K。
2. 啟用「排序凍結」。
3. 在主控台執行 `TeleTether.diagnostics(true)`。
4. 讓原本已存在的群組收到訊息，重現清單移動。
5. 執行 `TeleTether.diagnostics(false)`，查看輸出報告。
6. 同時確認最後訊息預覽與未讀數仍有正常更新。

若項目移動時出現 `updateItem`，呼叫堆疊可協助定位索引更新來源；若出現 `addItems`、置頂項目操作或 `clear`，則應先判斷是否為新項目、置頂或清單重建造成的正常位置變動。

目前尚未在使用者的 Telegram 帳號上實測 0.1.1。診斷只監看虛擬清單公開的變更方法，若原生程式直接透過其他內部狀態改動排序，仍需另外追查。

## Telegram Web K 原始碼參考

- [AutonomousDialogListBase](https://github.com/morethanwords/tweb/blob/master/src/components/autonomousDialogList/base.ts)
- [AutonomousDialogList](https://github.com/morethanwords/tweb/blob/master/src/components/autonomousDialogList/dialogs.ts)
- [SortedDialogList](https://github.com/morethanwords/tweb/blob/master/src/components/sortedDialogList.ts)
- [DeferredSortedVirtualList](https://github.com/morethanwords/tweb/blob/master/src/components/deferredSortedVirtualList.tsx)
- [AppDialogsManager](https://github.com/morethanwords/tweb/blob/master/src/lib/appDialogsManager.ts)
