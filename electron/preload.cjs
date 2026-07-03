const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('priceActionKnowledge', {
  readRuleCards: () => ipcRenderer.invoke('knowledge:readRuleCards')
})
