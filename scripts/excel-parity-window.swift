// Resolve the exact audited native Excel window for screencapture -l.
// Screen-region capture is unsafe because other applications may cover Excel.
import CoreGraphics
import Foundation
let expectedName = CommandLine.arguments[1]
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
let candidates = windows.filter {
    ($0[kCGWindowOwnerName as String] as? String) == "Microsoft Excel" &&
    (($0[kCGWindowName as String] as? String) == expectedName ||
     ($0[kCGWindowName as String] as? String)?.hasPrefix(expectedName + ".") == true ||
     ($0[kCGWindowName as String] as? String)?.hasPrefix(expectedName + "  -") == true) &&
    ($0[kCGWindowLayer as String] as? Int) == 0
}
guard candidates.count == 1, let identifier = candidates[0][kCGWindowNumber as String] as? Int else {
    fputs("Expected exactly one Excel workbook window named \(expectedName), found \(candidates.count)\n", stderr)
    exit(2)
}
let bounds = candidates[0][kCGWindowBounds as String] as! [String: Any]
let data = try! JSONSerialization.data(withJSONObject: ["id": identifier, "bounds": bounds, "name": candidates[0][kCGWindowName as String] ?? expectedName], options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
