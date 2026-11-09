import path from 'path'
import { ERROR_CODE } from '../../shared/errorCodes'
import { LauncherError } from '../../shared/LauncherError'

/**
 * Converts a Maven identifier into its repository-relative path.
 * `net.fabricmc:fabric-loader:0.15.7` → `net/fabricmc/fabric-loader/0.15.7/fabric-loader-0.15.7.jar`
 *
 * Only loader libraries are named this way (Mojang's carry `downloads.artifact`), so a name
 * without its three parts is a broken loader profile.
 *
 * @param {string} identifier group:artifact:version[:classifier]
 * @returns {string} Path using the platform separator.
 */
export function mavenToRelativePath(identifier: string): string {
    const [group, artifact, version, classifier] = identifier.split(':')
    if (!group || !artifact || !version) {
        throw new LauncherError(ERROR_CODE.MODLOADER_FAILED, `El mod loader declara una libreria con un nombre no valido: ${identifier}`)
    }
    const suffix = classifier ? `-${classifier}` : ''
    const fileName = `${artifact}-${version}${suffix}.jar`
    return path.join(...group.split('.'), artifact, version, fileName)
}

/**
 * Builds the download URL for a Maven identifier hosted on the given repository.
 */
export function mavenToUrl(repositoryUrl: string, identifier: string): string {
    const relativeUrl = mavenToRelativePath(identifier).split(path.sep).join('/')
    return `${repositoryUrl.endsWith('/') ? repositoryUrl : `${repositoryUrl}/`}${relativeUrl}`
}
