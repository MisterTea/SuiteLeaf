import type { RefObject } from "react";
import { Menu, MenuCheckItem, MenuItem, SubMenu, type EditorActions } from "../ui";
import { EditorHelp } from "./workspace-help-menu";

export function SlideMenus({
  actions,
}: {
  actions: RefObject<EditorActions | undefined>;
}) {
  return (
    <>
      <Menu label="Edit">
        <MenuItem
          shortcut="Cmd+Z"
          availability={() =>
            actions.current?.slideActions?.undoReason?.() ?? true
          }
          onSelect={() => actions.current?.slideActions?.undo()}
        >
          Undo
        </MenuItem>
        <MenuItem
          shortcut="Cmd+Y"
          availability={() =>
            actions.current?.slideActions?.redoReason?.() ?? true
          }
          onSelect={() => actions.current?.slideActions?.redo()}
        >
          Redo
        </MenuItem>
        <MenuItem
          shortcut="Cmd+X"
          onSelect={() => actions.current?.slideActions?.cut()}
        >
          Cut
        </MenuItem>
        <MenuItem
          shortcut="Cmd+C"
          onSelect={() => actions.current?.slideActions?.copy()}
        >
          Copy
        </MenuItem>
        <MenuItem
          shortcut="Cmd+V"
          onSelect={() => actions.current?.slideActions?.paste()}
        >
          Paste
        </MenuItem>
      </Menu>
      <Menu label="View">
      <MenuItem
        shortcut="Cmd+Enter"
        onSelect={() => void actions.current?.present?.()}
      >
        Slideshow
      </MenuItem>
      <MenuItem
        synonyms={["presenter", "speaker notes", "presenter view"]}
        onSelect={() =>
          actions.current?.slideActions?.presenterView?.()
        }
      >
        Presenter view
      </MenuItem>
        <MenuItem onSelect={() => void actions.current?.print()}>
          Print preview
        </MenuItem>
        <MenuItem
          synonyms={["handout", "slide handouts"]}
          onSelect={() =>
            actions.current?.slideActions?.handouts?.()
          }
        >
          Handouts
        </MenuItem>
        <MenuCheckItem
          checked={
            !!actions.current?.slideActions?.slideNumbers?.()
          }
          onSelect={() =>
            actions.current?.slideActions?.toggleSlideNumbers?.()
          }
        >
          Slide numbers
        </MenuCheckItem>
      </Menu>
      <Menu label="Insert">
        <MenuItem
          synonyms={["text box", "insert text box", "textbox"]}
          focusesTarget
          onSelect={() =>
            actions.current?.slideActions?.insertTextBox()
          }
        >
          Text box
        </MenuItem>
        <MenuItem
          synonyms={["image", "insert image", "picture", "photo"]}
          onSelect={() =>
            actions.current?.slideActions?.insertImage()
          }
        >
          Image
        </MenuItem>
        <MenuItem
          synonyms={["audio", "insert audio", "sound"]}
          onSelect={() =>
            actions.current?.slideActions?.insertAudio()
          }
        >
          Audio
        </MenuItem>
        <MenuItem
          synonyms={["video", "insert video", "movie"]}
          onSelect={() =>
            actions.current?.slideActions?.insertVideo()
          }
        >
          Video
        </MenuItem>
        <SubMenu label="Shape">
          <MenuItem
            synonyms={["shape", "insert shape", "rectangle"]}
            onSelect={() =>
              actions.current?.slideActions?.insertShape("rect")
            }
          >
            Rectangle
          </MenuItem>
          <MenuItem
            onSelect={() =>
              actions.current?.slideActions?.insertShape(
                "roundRect",
              )
            }
          >
            Rounded rectangle
          </MenuItem>
          <MenuItem
            onSelect={() =>
              actions.current?.slideActions?.insertShape("ellipse")
            }
          >
            Ellipse
          </MenuItem>
        </SubMenu>
        <MenuItem
          synonyms={["word art", "wordart"]}
          focusesTarget
          onSelect={() =>
            actions.current?.slideActions?.insertWordArt()
          }
        >
          Word art
        </MenuItem>
        <SubMenu label="Animation">
          {(
            [
              ["fade-on-click", "Fade in on click", ["fade in", "animation"]],
              ["appear-on-click", "Appear on click", ["appear"]],
              ["fly-on-click", "Fly in on click", ["fly in"]],
              ["wipe-on-click", "Wipe on click", ["wipe"]],
              ["zoom-on-click", "Zoom in on click", ["zoom in"]],
            ] as const
          ).map(([kind, label, synonyms]) => (
            <MenuItem
              key={kind}
              synonyms={[...synonyms]}
              availability={() =>
                actions.current?.slideActions?.animationReason?.(kind) ??
                actions.current?.slideActions?.fadeOnClickReason?.() ??
                true
              }
              onSelect={() => {
                const slideActions = actions.current?.slideActions;
                if (slideActions?.animate) slideActions.animate(kind);
                else if (kind === "fade-on-click") slideActions?.fadeOnClick?.();
              }}
            >
              {label}
            </MenuItem>
          ))}
          <MenuItem
            onSelect={() => actions.current?.slideActions?.animate?.(null)}
          >
            Remove animation
          </MenuItem>
        </SubMenu>
        <MenuItem
          shortcut="Cmd+M"
          onSelect={() => actions.current?.slideActions?.newSlide()}
        >
          New slide
        </MenuItem>
      </Menu>
      <Menu label="Format">
        <SubMenu label="Text">
          <MenuItem
            shortcut="Cmd+B"
            onSelect={() =>
              actions.current?.slideActions?.toggleBold()
            }
          >
            Bold
          </MenuItem>
          <MenuItem
            shortcut="Cmd+I"
            onSelect={() =>
              actions.current?.slideActions?.toggleItalic()
            }
          >
            Italic
          </MenuItem>
        </SubMenu>
        <SubMenu label="Align & indent">
          <MenuItem
            onSelect={() =>
              actions.current?.slideActions?.align("left")
            }
          >
            Align left
          </MenuItem>
          <MenuItem
            onSelect={() =>
              actions.current?.slideActions?.align("center")
            }
          >
            Center
          </MenuItem>
          <MenuItem
            onSelect={() =>
              actions.current?.slideActions?.align("right")
            }
          >
            Align right
          </MenuItem>
        </SubMenu>
      </Menu>
      <Menu label="Slide">
        <MenuItem
          shortcut="Cmd+M"
          onSelect={() => actions.current?.slideActions?.newSlide()}
        >
          New slide
        </MenuItem>
        <MenuItem
          shortcut="Cmd+D"
          onSelect={() =>
            actions.current?.slideActions?.duplicate()
          }
        >
          Duplicate slide
        </MenuItem>
        <MenuItem
          shortcut="Delete"
          availability={() =>
            actions.current?.slideActions?.deleteReason?.() ?? true
          }
          onSelect={() =>
            actions.current?.slideActions?.deleteSlides()
          }
        >
          Delete slide
        </MenuItem>
        <MenuItem
          shortcut="Cmd+Up"
          onSelect={() => actions.current?.slideActions?.move("up")}
        >
          Move up
        </MenuItem>
        <MenuItem
          shortcut="Cmd+Down"
          onSelect={() =>
            actions.current?.slideActions?.move("down")
          }
        >
          Move down
        </MenuItem>
        <MenuItem
          shortcut="Cmd+Shift+Up"
          onSelect={() =>
            actions.current?.slideActions?.move("start")
          }
        >
          Move to start
        </MenuItem>
        <MenuItem
          shortcut="Cmd+Shift+Down"
          onSelect={() =>
            actions.current?.slideActions?.move("end")
          }
        >
          Move to end
        </MenuItem>
        <SubMenu label="Apply layout">
          <MenuItem
            onSelect={() =>
              actions.current?.slideActions?.applyLayout("title")
            }
          >
            Title slide
          </MenuItem>
          <MenuItem
            onSelect={() =>
              actions.current?.slideActions?.applyLayout(
                "title-body",
              )
            }
          >
            Title & body
          </MenuItem>
          <MenuItem
            onSelect={() =>
              actions.current?.slideActions?.applyLayout(
                "two-column",
              )
            }
          >
            Two columns
          </MenuItem>
          <MenuItem
            onSelect={() =>
              actions.current?.slideActions?.applyLayout("section")
            }
          >
            Section header
          </MenuItem>
          <MenuItem
            onSelect={() =>
              actions.current?.slideActions?.applyLayout("blank")
            }
          >
            Blank slide
          </MenuItem>
        </SubMenu>
        <MenuItem
          onSelect={() =>
            actions.current?.slideActions?.openTheme()
          }
        >
          Change theme
        </MenuItem>
        <MenuItem
          onSelect={() =>
            actions.current?.slideActions?.openTransition()
          }
        >
          Transition
        </MenuItem>
        <MenuItem
          synonyms={["animation pane", "animations"]}
          onSelect={() =>
            actions.current?.slideActions?.openAnimationPane?.()
          }
        >
          Animation pane
        </MenuItem>
        <MenuItem
          synonyms={["slide master", "master"]}
          onSelect={() =>
            actions.current?.slideActions?.openMaster?.()
          }
        >
          Edit master
        </MenuItem>
      </Menu>
      <Menu label="Comments">
        <MenuItem
          shortcut="Cmd+Alt+M"
          synonyms={["comment", "comments", "add comment"]}
          focusesTarget
          onSelect={() =>
            actions.current?.slideActions?.insertComment?.()
          }
        >
          Comment
        </MenuItem>
        <MenuItem
          synonyms={[
            "resolved",
            "resolved comments",
            "reopen",
            "comment history",
          ]}
          onSelect={() =>
            actions.current?.slideActions?.openResolved?.()
          }
        >
          Resolved
        </MenuItem>
      </Menu>
      <Menu label="Tools">
        <MenuItem
          focusesTarget
          onSelect={() =>
            actions.current?.slideActions?.openSpelling?.()
          }
        >
          Spelling
        </MenuItem>
      </Menu>
      <EditorHelp />
    </>
  );
}
