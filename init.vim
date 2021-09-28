" Force Vim to use 256 colors if running in a capable terminal emulator:
if &term =~ "xterm" || &term =~ "256" || $DISPLAY != "" || $HAS_256_COLORS == "yes"
    set t_Co=256
endif
set t_Co=256

colorscheme desert

silent! call plug#begin()
Plug 'neovim/pynvim'
Plug 'ycm-core/YouCompleteMe'
Plug 'tpope/vim-sensible'
Plug 'tpope/vim-dispatch'
Plug 'tpope/vim-fugitive'
Plug 'scrooloose/nerdtree', { 'on': 'NERDTreeToggle' }
Plug 'chrisbra/csv.vim'
Plug 'jalvesaq/southernlights'
Plug 'jalvesaq/vimcmdline' 
Plug 'mkitt/tabline.vim'
Plug 'vim-airline/vim-airline'  " Status and tab bar
Plug 'vim-airline/vim-airline-themes'
Plug 'mhinz/vim-startify'
Plug 'powerline/powerline-fonts'
Plug 'powerline/powerline'
Plug 'qpkorr/vim-bufkill'
Plug 'jamessan/vim-gnupg'
Plug 'jpalardy/vim-slime'
Plug 'vim-syntastic/syntastic'
Plug 'stefandtw/quickfix-reflector.vim'
call plug#end()

augroup ScrollbarInit
  autocmd!
  autocmd CursorMoved,VimResized,QuitPre * silent! lua require('scrollbar').show()
  autocmd WinEnter,FocusGained           * silent! lua require('scrollbar').show()
  autocmd WinLeave,FocusLost             * silent! lua require('scrollbar').clear()
augroup end

let g:ycm_autoclose_preview_window_after_completion = 1
let g:ycm_show_diagnostics_ui = 0

set hidden " allow hidden buffers (don't force write when changing)
set number
set relativenumber

" For vim-airline, ensure the status line is always displayed:
set laststatus=2
" Enable the list of buffers
let g:airline#extensions#tabline#enabled = 1
let g:airline#extensions#tabline#fnamemod = ':t' " Show just the filename
let g:airline_powerline_fonts = 1
let g:airline_theme='wombat'

set statusline+=%#warningmsg#
set statusline+=%{SyntasticStatuslineFlag()}
set statusline+=%*

let g:syntastic_always_populate_loc_list = 1
let g:syntastic_auto_loc_list = 1
let g:syntastic_check_on_open = 1
let g:syntastic_check_on_wq = 0
" let g:syntastic_cpp_remove_include_errors = 0
" let g:syntastic_cpp_checkers = []
" let g:syntastic_c_checkers = []
nnoremap <F8> <Esc>:SyntasticCheck<CR>
" to configure flake8 use ~/tox.ini
" let g:syntastic_cpp_include_dirs = ['']


autocmd TabEnter * call airline#highlighter#highlight(['normal', &modified ? 'modified' : ''])

set nocompatible
syntax enable
filetype plugin on
filetype indent on

syntax on
set mps+=<:>

inoremap <c-space> <c-x><c-o>

set hlsearch
set tabstop=4
set shiftwidth=4
set expandtab
set list
set listchars=tab:>-
set foldmethod=manual

nnoremap <F1> <Esc>:bprevious<CR>
nnoremap <F2> <Esc>:bnext<CR>
nnoremap <F3> <Esc>:NERDTreeToggle<CR>
nnoremap <F4> <Esc>:BD<CR>
nnoremap <s-F4> <Esc>:quit<CR>
nnoremap <F16> <Esc>:quit<CR>

set makeprg=make
nnoremap <expr> <F5> '<Esc>:Make -C build<CR>'
nnoremap <s-F1> <Esc>:cprev<CR>
nnoremap <F13> <Esc>:cprev<CR>
nnoremap <s-F2> <Esc>:cnext<CR>
nnoremap <F14> <Esc>:cnext<CR>


nnoremap gg <Esc>:YcmCompleter GoTo<CR>
nnoremap gd <Esc>:YcmCompleter GoToDeclaration<CR>
nnoremap gf <Esc>:YcmCompleter GoToDefinition<CR>
nnoremap gt <Esc>:YcmCompleter GetType<CR>


" prevent accidentally closing the last window
cabbrev q <c-r>=(getcmdtype()==':' && getcmdpos()==1 ? 'echo' : 'q')<CR>

set foldlevelstart=20
" set nofoldenable

autocmd BufRead,BufNewFile *.todo set filetype=todo

if filereadable("local.vim")
  source local.vim
endif

tnoremap <Esc> <C-\><C-n>
tnoremap <C-v><Esc> <Esc>


let g:slime_python_ipython = 1
let g:slime_target = "neovim"

fun! StartREPL()
  execute 'terminal'
  setlocal nonumber
  let t:term_id = b:terminal_job_id
  wincmd p
  execute 'let b:slime_config = {"jobid": "'.t:term_id . '"}'
endfun

nmap <F9> <Plug>SlimeLineSend
nmap <S-F9> <Plug>SlimeSend
nmap <F10> <Plug>SlimeParagraphSend
set splitbelow
nmap <F12> tt :split <bar>:call StartREPL()<CR>

" vimcmdline mappings
let cmdline_map_start          = '<LocalLeader>z'
let cmdline_map_send           = '<Space>'
let cmdline_map_send_and_stay  = '<LocalLeader><Space>'
let cmdline_map_source_fun     = '<LocalLeader>f'
let cmdline_map_send_paragraph = '<LocalLeader>p'
let cmdline_map_send_block     = '<LocalLeader>b'
let cmdline_map_quit           = '<LocalLeader>q'

" vimcmdline options
let cmdline_vsplit      = 0      " Split the window vertically
let cmdline_esc_term    = 1      " Remap <Esc> to :stopinsert in Neovim's terminal
let cmdline_in_buffer   = 1      " Start the interpreter in a Neovim's terminal
let cmdline_term_height = 15     " Initial height of interpreter window or pane
let cmdline_term_width  = 80     " Initial width of interpreter window or pane
let cmdline_tmp_dir     = '/tmp' " Temporary directory to save files
let cmdline_outhl       = 1      " Syntax highlight the output
let cmdline_auto_scroll = 1      " Keep the cursor at the end of terminal (nvim)

let cmdline_app           = {}
let cmdline_app['python'] = 'ipython'
let cmdline_app['ruby']   = 'pry'
let cmdline_app['sh']     = 'bash'

nnoremap <A-down> :m .+1<CR>==
nnoremap <A-up> :m .-2<CR>==
inoremap <A-down> <Esc>:m .+1<CR>==gi
inoremap <A-up> <Esc>:m .-2<CR>==gi
vnoremap <A-down> :m '>+1<CR>gv=gv
vnoremap <A-up> :m '<-2<CR>gv=gv

hi TabLine      ctermfg=Black  ctermbg=Green     cterm=NONE
hi TabLineFill  ctermfg=Black  ctermbg=Red     cterm=NONE
hi TabLineSel   ctermfg=White  ctermbg=DarkRed  cterm=NONE
hi IncSearch    cterm=NONE ctermfg=yellow ctermbg=darkgreen
hi Search       ctermbg=DarkYellow ctermfg=White

hi CursorLine   cterm=NONE ctermbg=52 ctermfg=NONE guibg=NONE guifg=NONE  
set cursorline

