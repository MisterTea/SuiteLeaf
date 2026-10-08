-- Read the audited Excel document's hosting viewport, without changing UI.
on run argv
 tell application "System Events" to tell process "Microsoft Excel"
  set w to window (item 1 of argv)
  set p to position of UI element 1 of splitter group 1 of w
  set s to size of UI element 1 of splitter group 1 of w
  return "{\"x\":" & item 1 of p & ",\"y\":" & item 2 of p & ",\"width\":" & item 1 of s & ",\"height\":" & item 2 of s & "}"
 end tell
end run
