if exists("b:current_syntax")
  finish
endif

scriptencoding utf-8

syn match todoDate "<\?\d\{1,4}\([-/:]\d\{1,4\}\)\{1,3\}>\?"

" Comments embedded in todo items, inside [].
syn match todoHighlight1  "\[.*\]"
syn match todoHighlight2  "{.*}"
syn match todoHighlight3  "<.*>"
syn match todoMark1	"^\*.*$"
syn match todoMark2	"^+.*$"
syn match todoMark3	"^-.*$"
syn match todoMark4	"^#.*$"
syn match todoMark5	"^!.*$"


" Colors and effects.
hi def link todoHighlight1           Comment
hi def link todoHighlight2           Constant
hi def link todoHighlight3           Special
hi def link todoMark1                Identifier
hi def link todoMark2                Statement
hi def link todoMark3                PreProc
hi def link todoMark4                Type
hi def link todoMark5                Underlined
hi def link todoMark6                Ignore

let b:current_syntax = "todo"

" vim: ts=8 sw=2
