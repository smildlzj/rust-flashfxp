"""Build the branded DMG without Finder automation (also works on CI)."""
import argparse
import plistlib
from pathlib import Path

import dmgbuild


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", required=True, type=Path, help="Tauri .app bundle")
    parser.add_argument("--output", required=True, type=Path, help="Output .dmg file")
    args = parser.parse_args()
    app = args.app.resolve()
    if not app.is_dir() or app.suffix != ".app":
        parser.error(f"Application bundle not found: {app}")
    with (app / "Contents/Info.plist").open("rb") as file:
        info = plistlib.load(file)
    assets = Path(__file__).resolve().parents[2] / "src-tauri/dmg"
    background = assets / "background.tiff"
    if not background.is_file():
        parser.error(f"Missing artwork: {background}; run render-background.swift")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    dmgbuild.build_dmg(
        str(args.output.resolve()),
        info.get("CFBundleDisplayName", app.stem),
        settings={
            "format": "UDZO",
            "filesystem": "HFS+",
            "files": [str(app)],
            "symlinks": {"Applications": "/Applications"},
            "icon": str(app / "Contents/Resources/icon.icns"),
            "background": str(background),
            "window_rect": ((180, 140), (720, 440)),
            "icon_locations": {app.name: (190, 232), "Applications": (530, 232)},
            "icon_size": 96,
            "text_size": 12,
            "default_view": "icon-view",
            "show_toolbar": False,
            "show_status_bar": False,
            "show_pathbar": False,
            "show_sidebar": False,
            "include_icon_view_settings": True,
            "include_list_view_settings": False,
            "arrange_by": None,
        },
    )
    print(f"Created {args.output}")


if __name__ == "__main__":
    main()
