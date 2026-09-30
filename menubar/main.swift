// Capitanía — ícono de barra de menú.
//
// No duplica lógica: es un cliente más de la misma API en :7788 que consume el
// dashboard web. Muestra cuántos proyectos están encendidos y permite prender o
// apagar sin abrir el panel.

import AppKit
import Foundation

// MARK: - Espejo de la API (server/src/domain/types.ts)

struct ProjectConfig: Decodable {
  let id: String
  let name: String
  let group: String
  let port: Int?
}

struct ProjectState: Decodable {
  let status: String
  let pid: Int?
}

struct ProjectEntry: Decodable {
  let config: ProjectConfig
  let state: ProjectState
}

struct Snapshot: Decodable {
  let projects: [ProjectEntry]
}

extension ProjectEntry {
  /// Encendido por Capitanía (o en camino de estarlo).
  var isUp: Bool { state.status == "running" || state.status == "starting" }
  /// Necesita atención: crasheó o alguien más tiene el puerto.
  var isWarning: Bool { state.status == "crashed" || state.status == "external" }

  var bullet: String {
    if isUp { return "●" }
    if state.status == "crashed" { return "✕" }
    if state.status == "external" { return "◆" }
    return "○"
  }
}

// MARK: - Cliente HTTP

enum API {
  static let port = ProcessInfo.processInfo.environment["CAPITANIA_PORT"] ?? "7788"
  static var base: String { "http://127.0.0.1:\(port)" }

  static func fetchState(completion: @escaping (Snapshot?) -> Void) {
    guard let url = URL(string: "\(base)/api/state") else { return completion(nil) }
    var request = URLRequest(url: url)
    request.timeoutInterval = 4
    URLSession.shared.dataTask(with: request) { data, _, _ in
      let snapshot = data.flatMap { try? JSONDecoder().decode(Snapshot.self, from: $0) }
      DispatchQueue.main.async { completion(snapshot) }
    }.resume()
  }

  static func post(_ path: String, body: [String: Any]? = nil, then: (() -> Void)? = nil) {
    guard let url = URL(string: "\(base)\(path)") else { return }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 30
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try? JSONSerialization.data(withJSONObject: body)
    }
    URLSession.shared.dataTask(with: request) { _, _, _ in
      DispatchQueue.main.async { then?() }
    }.resume()
  }
}

// MARK: - Controlador

final class MenuBarController: NSObject, NSMenuDelegate {
  private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  private let menu = NSMenu()
  private var entries: [ProjectEntry] = []
  private var reachable = false
  private var timer: Timer?

  override init() {
    super.init()
    menu.delegate = self
    statusItem.menu = menu

    if let button = statusItem.button {
      button.image = NSImage(
        systemSymbolName: "powerplug.fill", accessibilityDescription: "Capitanía")
      button.image?.isTemplate = true
      button.imagePosition = .imageLeading
    }

    refresh()
    // El título se refresca solo; el menú se reconstruye al abrirlo.
    timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
      self?.refresh()
    }
  }

  private func refresh() {
    API.fetchState { [weak self] snapshot in
      guard let self else { return }
      self.reachable = snapshot != nil
      self.entries = snapshot?.projects ?? []
      self.updateTitle()
    }
  }

  private func updateTitle() {
    guard let button = statusItem.button else { return }
    if !reachable {
      button.title = " —"
      button.toolTip = "Capitanía: el servidor no responde en \(API.base)"
      return
    }
    let up = entries.filter(\.isUp).count
    button.title = " \(up)/\(entries.count)"
    button.toolTip = "Capitanía: \(up) de \(entries.count) proyectos encendidos"
  }

  // MARK: Construcción del menú

  /// Se reconstruye en cada apertura: así no hay estado desincronizado y el
  /// costo se paga solo cuando el usuario mira.
  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()

    guard reachable else {
      menu.addItem(disabled("El servidor no responde"))
      menu.addItem(.separator())
      menu.addItem(action("Abrir panel completo", #selector(openDashboard)))
      menu.addItem(action("Salir", #selector(quit)))
      return
    }

    let running = entries.filter(\.isUp)
    let warnings = entries.filter(\.isWarning)

    if running.isEmpty {
      menu.addItem(disabled("Nada encendido"))
    } else {
      menu.addItem(disabled("Encendidos (\(running.count)) — clic para apagar"))
      for entry in running {
        menu.addItem(projectItem(entry, selector: #selector(stopProject(_:))))
      }
    }

    if !warnings.isEmpty {
      menu.addItem(.separator())
      menu.addItem(disabled("Atención (\(warnings.count))"))
      for entry in warnings {
        let item = projectItem(entry, selector: nil)
        item.toolTip = entry.state.status == "external"
          ? "El puerto lo ocupa un proceso que Capitanía no lanzó"
          : "Terminó con error — revisa los logs en el panel"
        menu.addItem(item)
      }
    }

    // Los apagados van en submenús por grupo: 25 en una lista plana no se lee.
    let stopped = entries.filter { !$0.isUp && !$0.isWarning }
    if !stopped.isEmpty {
      menu.addItem(.separator())
      let encender = NSMenuItem(title: "Encender", action: nil, keyEquivalent: "")
      let submenu = NSMenu()
      for group in groupNames(of: stopped) {
        let groupItem = NSMenuItem(title: group, action: nil, keyEquivalent: "")
        let groupMenu = NSMenu()
        for entry in stopped where entry.config.group == group {
          groupMenu.addItem(projectItem(entry, selector: #selector(startProject(_:))))
        }
        groupItem.submenu = groupMenu
        submenu.addItem(groupItem)
      }
      encender.submenu = submenu
      menu.addItem(encender)
    }

    menu.addItem(.separator())
    menu.addItem(action("Abrir panel completo", #selector(openDashboard), key: "o"))
    let stopAll = action("Apagar todo", #selector(stopAllProjects(_:)))
    stopAll.isEnabled = !running.isEmpty
    menu.addItem(stopAll)
    menu.addItem(.separator())
    menu.addItem(action("Salir", #selector(quit), key: "q"))
  }

  private func groupNames(of entries: [ProjectEntry]) -> [String] {
    var seen = Set<String>()
    return entries.map(\.config.group)
      .filter { seen.insert($0).inserted }
      .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
  }

  private func projectItem(_ entry: ProjectEntry, selector: Selector?) -> NSMenuItem {
    let port = entry.config.port.map { ":\($0)" } ?? ""
    let item = NSMenuItem(
      title: "\(entry.bullet)  \(entry.config.name)  \(port)",
      action: selector, keyEquivalent: "")
    item.target = self
    item.representedObject = entry.config.id
    item.isEnabled = selector != nil
    return item
  }

  private func disabled(_ title: String) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    item.isEnabled = false
    return item
  }

  private func action(_ title: String, _ selector: Selector, key: String = "") -> NSMenuItem {
    let item = NSMenuItem(title: title, action: selector, keyEquivalent: key)
    item.target = self
    return item
  }

  // MARK: Acciones

  @objc private func startProject(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String else { return }
    API.post("/api/projects/\(id)/start") { [weak self] in self?.refresh() }
  }

  @objc private func stopProject(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String else { return }
    API.post("/api/projects/\(id)/stop") { [weak self] in self?.refresh() }
  }

  @objc private func stopAllProjects(_ sender: NSMenuItem) {
    let ids = entries.filter(\.isUp).map(\.config.id)
    guard !ids.isEmpty else { return }
    API.post("/api/projects/batch/stop", body: ["ids": ids]) { [weak self] in self?.refresh() }
  }

  @objc private func openDashboard() {
    let app = URL(fileURLWithPath: "/Applications/Capitania.app")
    if FileManager.default.fileExists(atPath: app.path) {
      NSWorkspace.shared.openApplication(at: app, configuration: .init())
    } else if let url = URL(string: API.base) {
      NSWorkspace.shared.open(url)
    }
  }

  @objc private func quit() {
    NSApp.terminate(nil)
  }
}

// MARK: - Arranque

let app = NSApplication.shared
// .accessory = vive en la barra de menú, sin ícono en el Dock ni menú propio.
app.setActivationPolicy(.accessory)
let controller = MenuBarController()
app.run()
