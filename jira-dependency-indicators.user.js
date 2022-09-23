// ==UserScript==
// @name         Jira Card Dependency Indicator
// @namespace    https://qoomon.github.io
// @version      1.0.9
// @updateURL    https://github.com/qoomon/userscript-jira-dependency-indicators/raw/main/aws-visual-account-indicator.user.js
// @downloadURL  https://github.com/qoomon/userscript-jira-dependency-indicators/raw/main/aws-visual-account-indicator.user.js
// @description  try to take over the world!
// @author       qoomon
// @match        https://*.atlassian.net/jira/core/projects/*/board
// @match        https://*.atlassian.net/jira/core/projects/*
// @match        https://*.atlassian.net/jira/software/c/projects/*/boards/*
// @match        https://*.atlassian.net/jira/software/c/projects/*
// @icon         https://www.atlassian.com/favicon.ico
// @grant        none
// ==/UserScript==

window.addEventListener('changestate', async () => {
    'use strict';

    if(![
      document.location.pathname.match(/^\/jira\/core\/projects\/[^/]+\/board$/),
      document.location.pathname.match(/^\/jira\/software\/c\/projects\/[^/]+\/boards\/[^/]+$/),
    ].some(Boolean)) {
       console.debug('skip', document.location.pathname);
       return
    }

    const project = detectProject()
    console.debug('project:', project);

    const boardElement = await untilDefined(() => getBoardElement())
    console.debug('board element:', boardElement)

    await updateCards()

    new MutationObserver(async (mutations) => {
        const nodesAdded = mutations.some(mutation => mutation.addedNodes.length > 0)
        if(nodesAdded) await updateCards()
    }).observe(boardElement, { childList: true, subtree: true })

    async function updateCards() {
        const boardCards = getBoardCards()
        const issues = await fetchIssueData(boardCards.map(card => card.key))
        boardCards.filter(card => !card.element._dependenyIndicator).forEach(async card => {
            card.element._dependenyIndicator = true

            console.debug("update card element: ", card.key)
            const issue = issues[card.key]

            if(issue.internalBlockingIssues.length > 0){
                console.debug('  has internal dependencies')
                card.element.appendChild(createCornerSvg('#ffab00', 'Issue has internal dependencies'))
            }

            if(issue.externalBlockingIssues.length > 0){
                console.debug('  has external dependencies')
                card.element.appendChild(createCornerSvg('#ff5631', 'Issue has external dependencies'))
            }
        })
    }

    // -------------------------------------------------------------------------

    async function fetchIssueData(keys) {
        fetchIssueData.cache = fetchIssueData.cache || {}

        const result = []
        const newKeys = []
        keys.forEach(key => {
            const issueData = fetchIssueData.cache[key]
            if(issueData) {
                result.push(issueData)
            } else {
                let promiseResolve = null
                 fetchIssueData.cache[key] = new Promise((resolve, reject) => { promiseResolve = resolve })
                 fetchIssueData.cache[key].resolve = promiseResolve
                newKeys.push(key)
            }
        })

        if(newKeys.length > 0) {
            const newIssues = []
            const issueRequestChunkSize = 100;
            for (let startAt = 0; startAt < newKeys.length; startAt += issueRequestChunkSize) {
                const keysChunk = newKeys.slice(startAt, startAt + issueRequestChunkSize);
                const newIssuesChunk = await fetch(`${window.location.origin}/rest/api/3/search/`
                                                   + `?jql=${encodeURIComponent(`key in (${keysChunk.join(',')})`)}`
                                                   + `&fields=issuelinks`
                                                   + `&maxResults=${issueRequestChunkSize}`)
                .then(res => res.json())
                .then(data => data.issues)

                newIssuesChunk.forEach(issue => {
                    const issuelinks = issue.fields.issuelinks.map(normalizeIssueLink)

                    const internalIssueLinks = issuelinks.filter(link => getProjectKey(link.issue.key) === project.key)
                    issue.internalBlockingIssues = internalIssueLinks.filter(isUnresolvedBlocker).map(link => link.issue)

                    const externalIssueLinks = issuelinks.filter(link => getProjectKey(link.issue.key) !== project.key)
                    issue.externalBlockingIssues = externalIssueLinks.filter(isUnresolvedBlocker).map(link => link.issue)
                })

                newIssues.push(...newIssuesChunk)
            }

            newIssues.forEach(issue => {
                fetchIssueData.cache[issue.key].resolve(issue)
                result.push(issue)
            })
        }

        return (await Promise.all(result))
            .reduce((issues, issue) => {
                issues[issue.key] = issue
                return issues
            }, {})

    }

    function normalizeIssueLink(link) {
        if(link.inwardIssue) {
            link.type.relation = link.type.inward
            link.issue = link.inwardIssue
        }
        if(link.outwardIssue) {
            link.type.relation = link.type.outward
            link.issue = link.outwardIssue
        }
        return link
    }

    function isUnresolvedBlocker(link) {
        return (
            (link.type.name === 'Blocks' && link.type.relation === 'is blocked by') ||
            (link.type.name === 'Dependencies' && link.type.relation === 'requires')
        )
        && link.issue.fields.status.statusCategory.name !== 'Done'
    }

    function getProjectKey(issueKey) {
        return issueKey.split('-')[0]
    }

    function getBoardCards() {
        if(project.type === 'team') {
            return [...document.querySelectorAll('div[data-rbd-draggable-id^="ISSUE::"]')].map(element => ({
                key: [...element.querySelectorAll('span')].find(e => e.innerText.startsWith(`${project.key}-`)).innerText,
                element
            }))
        }
        if(project.type === 'company') {
            return [...document.querySelectorAll('.ghx-issue')].map(element => ({
                key: element.getAttribute('data-issue-key'),
                element
            }))
        }
    }

    function getBoardElement() {
        if(project.type === 'team') {
            return document.querySelector('#ak-main-content > div > div > div > div:last-child')
        }
        if(project.type === 'company') {
            return document.querySelector('#ghx-work')
        }
    }

    function createCornerSvg(color, title) {
        var svg = document.createElementNS("http://www.w3.org/2000/svg",'svg');
        svg.setAttribute("width", "16")
        svg.setAttribute("height", "16")
        if(project.type === 'company') {
            svg.setAttribute("data-tooltip", title)
        }
        svg.innerHTML = '<polygon points="0,0 0,16 16,0"></polygon>'
        if(project.type === 'team') {
             svg.innerHTML += `<title>${title}</title>`
        }
        svg.style.cssText = `
            fill: ${color};
            position: absolute;
            top: 0;
            left: 0;
            border-radius: 2px;
        `
        return svg
    }
})

function detectProject() {
    const project = {
        key: document.location.pathname.match(/\/projects\/(?<project>[^/]+)\//).groups.project
    }

    if(document.location.pathname.startsWith('/jira/core')) {
        project.type = 'team'
    }
    if(document.location.pathname.startsWith('/jira/software')) {
        project.type = 'company'
    }

    return project
}

async function untilDefined(fn) {
        return new Promise(resolve => {
            const interval = setInterval(() => {
                const result = fn()
                if (result != undefined) {
                    clearInterval(interval)
                    resolve(result)
                }
            }, 100)
        })
    }


// -----------------------------------------------------------------------------

window.history.pushState = new Proxy(window.history.pushState, {
  apply: (target, thisArg, argArray) => {
    const result = target.apply(thisArg, argArray)
    window.dispatchEvent(new Event('pushstate'))
    window.dispatchEvent(new Event('changestate'))
    return result
  }
})

window.history.replaceState = new Proxy(window.history.replaceState, {
  apply: (target, thisArg, argArray) => {
    const result = target.apply(thisArg, argArray)
    window.dispatchEvent(new Event('replacestate'))
    window.dispatchEvent(new Event('changestate'))
    return result
  }
})

window.addEventListener('popstate', () => {
    window.dispatchEvent(new Event('changestate'));
})
