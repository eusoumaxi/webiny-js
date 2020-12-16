import { CmsContentModelGroupType, CmsContext } from "@webiny/api-headless-cms/types";
import { toSlug } from "@webiny/api-headless-cms/utils";
import shortid from "shortid";

export const beforeCreateHook = async (
    context: CmsContext,
    model: CmsContentModelGroupType
): Promise<void> => {
    const { name, slug } = model;
    // If there is a slug assigned, check if it's unique ...
    if (slug) {
        const groups = (
            await context.cms.groups.list({
                search: {
                    slug
                },
                limit: 1
            })
        ).filter(g => g.id !== model.id);
        if (groups.length === 0) {
            return;
        }
        throw Error(`Content model group with the slug "${slug}" already exists.`);
    }

    // ... otherwise, assign a unique slug automatically.
    const newSlug = toSlug(name);
    const groups = await context.cms.groups.list({
        search: {
            slug: newSlug
        },
        limit: 1
    });

    if (groups.length === 0) {
        model.slug = newSlug;
        return;
    }

    model.slug = `${newSlug}-${shortid.generate()}`;
};