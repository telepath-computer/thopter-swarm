require "nvchad.options"

-- Neovim options for thopter dev environments

-- OSC 52 clipboard: lets neovim yank/paste reach the host system clipboard
-- over SSH and tmux. The osc52 module is built into neovim 0.10+ but must be
-- explicitly configured. The terminal escape sequence travels through
-- tmux -> SSH -> iTerm, which sets the local macOS clipboard.
vim.opt.clipboard = "unnamedplus"

vim.g.clipboard = {
  name = "OSC 52",
  copy = {
    ["+"] = require("vim.ui.clipboard.osc52").copy("+"),
    ["*"] = require("vim.ui.clipboard.osc52").copy("*"),
  },
  paste = {
    ["+"] = require("vim.ui.clipboard.osc52").paste("+"),
    ["*"] = require("vim.ui.clipboard.osc52").paste("*"),
  },
}

-- Tab / indent: 2 spaces everywhere
vim.opt.expandtab = true
vim.opt.tabstop = 2
vim.opt.shiftwidth = 2
vim.opt.softtabstop = 2

-- Soft wrapping
vim.opt.wrap = true
vim.opt.linebreak = true
vim.opt.breakindent = true
vim.opt.breakindentopt = "shift:4"
vim.opt.autoindent = true

-- Markdown formatting: proper gq behavior with bullet lists
vim.api.nvim_create_autocmd("BufEnter", {
  pattern = { "*.md", "*.markdown" },
  callback = function()
    vim.schedule(function()
      vim.opt_local.formatoptions = "tcqj"
      vim.opt_local.formatlistpat = [[^\s*\d\+[\]:.)}\t ]\s*]]
      vim.opt_local.comments = "fb:-,fb:*,n:>"
      vim.opt_local.indentexpr = ""
    end)
  end,
})

-- Keybindings -----------------------------------------------------------------

local map = vim.keymap.set

-- Copy file path to clipboard
map("n", "<leader>yP", function()
  local filepath = vim.fn.expand("%:p")
  vim.fn.setreg("+", filepath)
  vim.notify("Copied: " .. filepath)
end, { desc = "Copy absolute file path to clipboard", noremap = true, silent = true })

map("n", "<leader>yp", function()
  local filepath = vim.fn.expand("%")
  vim.fn.setreg("+", filepath)
  vim.notify("Copied: " .. filepath)
end, { desc = "Copy relative file path to clipboard", noremap = true, silent = true })
