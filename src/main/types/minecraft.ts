/**
 * Mojang version JSON (`common/versions/<id>/<id>.json`) and Fabric Meta's loader profile, with
 * only the fields the launcher reads. Mojang's files are written by helios-core after checking
 * them against Mojang's own index, and Fabric's by `ModLoaderManager` after checking its id;
 * every field below is still read defensively, since the format is Mojang's and moves with it.
 */

/** Mojang's rule: with rules an entry starts disallowed and the last match wins (`LaunchManager.rulesAllow`). */
export interface Rule {
    action: 'allow' | 'disallow'
    os?: {
        name?: string
        arch?: string
        /** A regular expression over the OS version. */
        version?: string
    }
    features?: Record<string, boolean>
}

/** An entry of `arguments.game` / `arguments.jvm`: plain, or conditional on rules. */
export type Argument = string | { rules?: Rule[], value: string | string[] }

export interface Artifact {
    path?: string
    url?: string
    sha1?: string
    size?: number
}

/**
 * A library in either of its two shapes: Mojang/Forge declare `downloads.artifact`, Fabric a
 * Maven `name` plus a repository `url`. Read through `LaunchManager.resolveLibraryArtifact`.
 */
export interface Library {
    name?: string
    url?: string
    sha1?: string
    size?: number
    rules?: Rule[]
    downloads?: { artifact?: Artifact }
}

export interface VersionJson {
    id?: string
    /** Set on a mod loader profile, which extends the vanilla version it names. */
    inheritsFrom?: string
    mainClass: string
    type?: string
    assets?: string
    assetIndex?: { id: string }
    libraries?: Library[]
    /** 1.13+. Its absence means the pre-1.13 `minecraftArguments`, which is not supported. */
    arguments?: { game?: Argument[], jvm?: Argument[] }
    javaVersion?: { majorVersion?: number }
}
