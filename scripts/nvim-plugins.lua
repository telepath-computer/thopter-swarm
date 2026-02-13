-- Thopter devbox plugins (loaded by NvChad's lazy.nvim via lua/plugins/)

return {
  -- Git signs in the gutter
  {
    "lewis6991/gitsigns.nvim",
    event = "VeryLazy",
    config = function()
      require("gitsigns").setup()
    end,
  },

  -- Scrollbar with draggable mouse support + gitsigns integration
  {
    "dstein64/nvim-scrollview",
    event = "VeryLazy",
    config = function()
      require("scrollview").setup({
        current_only = true,
        signs_on_startup = {
          "conflicts",
          "cursor",
          "diagnostics",
          "folds",
          "indent",
          "latestchange",
          "keywords",
          "loclist",
          "marks",
          "quickfix",
          "search",
          "spell",
          "textwidth",
        },
        diagnostics_severities = { vim.diagnostic.severity.ERROR },
      })
      -- Gitsigns integration: show git diff markers in scrollbar
      require("scrollview.contrib.gitsigns").setup()
    end,
  },
}
