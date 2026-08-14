import path from 'path'

/**
 * Converts a Maven identifier into its repository-relative path.
 * `net.fabricmc:fabric-loader:0.15.7` → `net/fabricmc/fabric-loader/0.15.7/fabric-loader-0.15.7.jar`
 *
 * @param {string} identifier group:artifact:version[:classifier]
 * @returns {string} Path using the platform separator.
 */
export function mavenToRelativePath(identifier) {
    const [group, artifact, version, classifier] = identifier.split(':')
    const suffix = classifier ? `-${classifier}` : ''
    const fileName = `${artifact}-${version}${suffix}.jar`
    return path.join(...group.split('.'), artifact, version, fileName)
}

/**
 * Builds the download URL for a Maven identifier hosted on the given repository.
 */
export function mavenToUrl(repositoryUrl, identifier) {
    const relativeUrl = mavenToRelativePath(identifier).split(path.sep).join('/')
    return `${repositoryUrl.endsWith('/') ? repositoryUrl : `${repositoryUrl}/`}${relativeUrl}`
}
